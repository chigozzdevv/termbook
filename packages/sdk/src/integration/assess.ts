import { useCaseReaderAbi, atomicSpotModuleAbi, termbookCoreAbi } from "@termbook/bindings";
import { parseAbi, keccak256, stringToHex, type Address, type Hex } from "viem";
import { canonicalEvidence, type PluginDefinition, type PluginStates, type UseCase } from "@termbook/schema";
import { check_state, type ReadContext } from "./plugin.js";
import { use_case_configuration } from "./use-case.js";

const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const idWord = (id: string): Hex => /^0x[a-fA-F0-9]{64}$/.test(id) ? id as Hex
  : /^\d+$/.test(id) && BigInt(id) < 2n ** 256n ? `0x${BigInt(id).toString(16).padStart(64, "0")}` : keccak256(stringToHex(id));
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function assess_state<U extends UseCase>(definition: PluginDefinition, input: unknown, context: ReadContext) {
  const state = check_state(definition.use_case as U, input, context);
  const c = definition.assessment ? use_case_configuration(definition) : undefined;
  const known = c ? [...c.reader.assets.map((a) => a.token), ...c.reader.markets.flatMap((m) => [m.asset0.token, ...(definition.use_case === "liquidity" ? [m.asset1.token] : [])]), definition.settlement_asset]
    : definition.markets.flatMap((m) => [m.base_asset, m.quote_asset]);
  for (const holding of state.holdings) {
    if (!known.some((asset) => equal(asset, holding.asset))) throw new Error("integration-holding-unregistered");
    if (!equal(holding.held_at, context.account)) continue;
    const actual = /^0x0{40}$/i.test(holding.asset) ? await context.client.getBalance({ address: context.account, blockNumber: context.block.number })
      : await context.client.readContract({ address: holding.asset as Address, abi: tokenAbi, functionName: "balanceOf",
        args: [context.account], blockNumber: context.block.number });
    if (actual !== holding.amount) throw new Error("integration-holding-mismatch");
  }
  if (!c && !definition.atomic_spot) return { state, verified: false as const };
  const reader = definition.contracts.reader as Address;
  const core = c ? await context.client.readContract({ address: reader, abi: useCaseReaderAbi, functionName: "core", blockNumber: context.block.number })
    : await context.client.readContract({ address: reader, abi: atomicSpotModuleAbi, functionName: "core", blockNumber: context.block.number });
  const credit = await context.client.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails",
    args: [context.credit_id], blockNumber: context.block.number });
  if (!equal(credit.account, context.account) || !equal(credit.bundleId, c?.version_id ?? keccak256(stringToHex(`termbook.integration.v1:${definition.chain_id}:${keccak256(stringToHex(canonicalEvidence(definition)))}`)))) {
    throw new Error("integration-assessment-credit-invalid");
  }
  const abi = c ? useCaseReaderAbi : atomicSpotModuleAbi;
  const reading = await context.client.readContract({ address: reader, abi, functionName: "readAppValue",
    args: [context.credit_id, context.account, definition.settlement_asset as Address], blockNumber: context.block.number });
  if (c) {
    const meta = await context.client.readContract({ address: reader, abi: useCaseReaderAbi, functionName: "meta",
      args: [context.credit_id, context.account], blockNumber: context.block.number });
    const positions = "positions" in state ? state.positions as PluginStates["perps"]["positions"] : [];
    const orders = "orders" in state ? state.orders : [];
    const requests = "requests" in state ? state.requests : [];
    const custody = c.reader.custody;
    for (let index = 0; index < custody.length; index++) {
      const slot = custody[index]!;
      const actual = await context.client.readContract({ address: reader, abi: useCaseReaderAbi, functionName: "custodyBalance",
        args: [context.credit_id, context.account, BigInt(index)], blockNumber: context.block.number });
      const holdings = state.holdings.filter((h) => equal(h.held_at, slot.target) && equal(h.asset, slot.token));
      if (holdings.length > 1 || holdings.length === 0 && actual > 0n || holdings[0] && holdings[0].amount !== actual) throw new Error("integration-holding-mismatch");
    }
    const held = state.holdings.filter((h) => !equal(h.held_at, context.account)
      && !custody.some((slot) => equal(h.held_at, slot.target) && equal(h.asset, slot.token)));
    if (BigInt(definition.use_case === "spot" ? held.length : positions.length) !== meta.positions
      || BigInt(orders.length) !== meta.pending || BigInt(requests.length) !== meta.requests) throw new Error("integration-state-count-mismatch");
    for (let index = 0; index < Number(meta.positions); index++) {
      const actual = await context.client.readContract({ address: reader, abi: useCaseReaderAbi, functionName: "position",
        args: [context.credit_id, context.account, BigInt(index)], blockNumber: context.block.number });
      if (definition.use_case === "spot") {
        const holding = held.find((h) => equal(idWord(h.holding_id), actual.id));
        const market = c.reader.markets.find((m) => equal(m.id, actual.market));
        if (!holding || !market || !equal(holding.asset, market.asset0.token) || holding.amount !== actual.quantity0
          || actual.liability !== 0n || actual.quantity1 !== 0n) throw new Error("integration-position-mismatch");
        continue;
      }
      const item = positions.find((p) => equal(idWord(p.position_id), actual.id));
      const market = c.reader.markets.find((m) => equal(m.id, actual.market));
      if (!item || !market || !equal(keccak256(stringToHex(item.market_id)), actual.market) || item.liability !== actual.liability
        || !equal(item.owner, actual.owner)) throw new Error("integration-position-mismatch");
      const quantities = new Map([[market.asset0.token.toLowerCase(), actual.quantity0],
        ...(definition.use_case === "liquidity" ? [[market.asset1.token.toLowerCase(), actual.quantity1] as const] : [])]);
      if (item.assets.some((a) => quantities.get(a.asset.toLowerCase()) !== a.amount)
        || [...quantities].some(([asset, amount]) => amount > 0n && !item.assets.some((a) => equal(a.asset, asset)))) throw new Error("integration-position-mismatch");
      const net = await context.client.readContract({ address: reader, abi: useCaseReaderAbi, functionName: "positionValue",
        args: [context.credit_id, context.account, BigInt(index)], blockNumber: context.block.number });
      if (item.recoverable_value > (net > 0n ? net : 0n)) throw new Error("integration-value-overstated");
      if (definition.use_case === "perps" && (item.margin !== actual.margin || item.notional !== actual.notional || item.unrealized_pnl !== actual.pnl)) {
        throw new Error("integration-position-mismatch");
      }
      const fields = item as unknown as Record<string, unknown>;
      if (definition.use_case === "liquidity") {
        const rewards = fields["rewards"] as { asset: string; amount: bigint }[];
        const nativeRewards = new Map([[market.asset0.token.toLowerCase(), actual.rewards0], [market.asset1.token.toLowerCase(), actual.rewards1]]);
        if (new Set(rewards.map((reward) => reward.asset.toLowerCase())).size !== rewards.length
          || rewards.some((reward) => nativeRewards.get(reward.asset.toLowerCase()) !== reward.amount)
          || [...nativeRewards].some(([asset, amount]) => amount > 0n && !rewards.some((reward) => equal(reward.asset, asset)))) {
          throw new Error("integration-position-mismatch");
        }
      }
      if (definition.use_case === "vault" && fields["shares"] !== actual.shares
        || definition.use_case === "staking" && (fields["staked"] !== actual.staked || fields["rewards"] !== actual.rewards0)
        || definition.use_case === "liquidity" && fields["liquidity"] !== actual.liquidity) throw new Error("integration-position-mismatch");
    }
    let pendingLiability = 0n;
    for (let index = 0; index < Number(meta.pending); index++) {
      const [id, actual] = await context.client.readContract({ address: reader, abi: useCaseReaderAbi, functionName: "order",
        args: [context.credit_id, context.account, BigInt(index)], blockNumber: context.block.number });
      const details = c.assessment.orders ? await context.client.readContract({ address: reader, abi: useCaseReaderAbi,
        functionName: "pendingDetails", args: [context.credit_id, context.account, id], blockNumber: context.block.number }) : undefined;
      const item = orders.find((o) => details ? o.order_id === String(details[2]) : equal(idWord(o.order_id), id));
      if (!item || item.remaining_input !== actual.remaining || item.filled_input !== actual.filled
        || (item.status === "cancel_requested") !== (actual.status === 2)) throw new Error("integration-order-mismatch");
      const orderMarket = details && definition.markets.find((m) => equal(keccak256(stringToHex(m.market_id)), details[0]));
      const buying = orderMarket && equal(details![1], orderMarket.quote_asset);
      if (details && (!orderMarket || !equal(keccak256(stringToHex(item.market_id)), details[0]) || !equal(item.input_asset, details[1])
        || !equal(details[1], buying ? orderMarket.quote_asset : orderMarket.base_asset)
        || !equal(item.output_asset, buying ? orderMarket.base_asset : orderMarket.quote_asset) || item.direction !== (buying ? "buy" : "sell")
        || item.filled_output !== undefined && item.filled_output !== 0n)) throw new Error("integration-order-mismatch");
      const exposure = await context.client.readContract({ address: reader, abi: useCaseReaderAbi, functionName: "pendingExposure",
        args: [context.credit_id, context.account, BigInt(index)], blockNumber: context.block.number });
      if (item.exposure !== exposure) throw new Error("integration-order-mismatch");
      pendingLiability += actual.maxLiability;
    }
    if (state.liabilities.some((l) => !equal(l.asset, definition.settlement_asset))
      || state.liabilities.reduce((sum, l) => sum + l.amount, 0n) !== pendingLiability) throw new Error("integration-liability-mismatch");
    for (let index = 0; index < Number(meta.requests); index++) {
      const actual = await context.client.readContract({ address: reader, abi: useCaseReaderAbi, functionName: "request",
        args: [context.credit_id, context.account, BigInt(index)], blockNumber: context.block.number });
      const item = requests.find((r) => equal(idWord(r.request_id), actual.id));
      const market = c.reader.markets.find((m) => equal(m.id, actual.market));
      const net = await context.client.readContract({ address: reader, abi: useCaseReaderAbi, functionName: "requestValue",
        args: [context.credit_id, context.account, BigInt(index)], blockNumber: context.block.number });
      if (!item || !market || !equal(keccak256(stringToHex(item.market_id)), actual.market) || BigInt(item.claimable_at) !== actual.claimableAt
        || item.liability !== actual.liability || item.recoverable_value > (net > 0n ? net : 0n)
        || !equal(item.replaces_position_id ? idWord(item.replaces_position_id) : `0x${"0".repeat(64)}`, actual.replacesPositionId)
        || actual.quantity1 !== 0n
        || item.assets.some((a) => !equal(a.asset, market.asset0.token) || a.amount !== actual.quantity0)
        || actual.quantity0 > 0n && !item.assets.some((a) => equal(a.asset, market.asset0.token))) throw new Error("integration-request-mismatch");
    }
  } else if (state.liabilities.length || "orders" in state && state.orders.length
    || state.holdings.some((h) => !equal(h.held_at, context.account))) throw new Error("integration-state-count-mismatch");
  for (const asset of known) {
    const actual = /^0x0{40}$/i.test(asset) ? await context.client.getBalance({ address: context.account, blockNumber: context.block.number })
      : await context.client.readContract({ address: asset as Address, abi: tokenAbi, functionName: "balanceOf", args: [context.account], blockNumber: context.block.number });
    if (actual > 0n && !state.holdings.some((h) => equal(h.held_at, context.account) && equal(h.asset, asset))) throw new Error("integration-holding-omitted");
  }
  if ((await context.client.getBlock({ blockNumber: context.block.number })).hash !== context.block.hash) throw new Error("integration-state-block-mismatch");
  return { state, verified: true as const, net_value: reading[0], retained_bps: reading[1], recovery_costs: reading[2], observed_at: reading[3] };
}
