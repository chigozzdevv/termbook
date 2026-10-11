import { canonicalEvidence, executionKey, selectCapability, type StandardAction } from "@termbook/schema";
import { termbookCoreAbi } from "@termbook/bindings";
import { decodeFunctionData, parseAbi, type PublicClient, type Address, type Hex } from "viem";
import { executionCoreAbi, buildExecution } from "../app/execution.js";
import { assess_state } from "./assess.js";
import { package_integration, check_plan, type plugin, type ActionContext } from "./plugin.js";

export type ActionProbe = { action: StandardAction; credit_id: Hex; tx_hash: Hex; minimum_receive?: bigint;
  maximum_spend?: bigint; price_bound?: bigint; position_state?: ActionContext["position_state"] };
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export async function validate_callbacks(client: PublicClient, value: plugin, input: {
  core: Address; active_credit_id: Hex; recovered_credit_id: Hex; probes: ActionProbe[];
}): Promise<void> {
  const { definition, version_id } = package_integration(value);
  const keys = input.probes.map((p) => executionKey(selectCapability(definition.actions, p.action)));
  if (keys.length !== definition.actions.length || new Set(keys).size !== keys.length
    || definition.actions.some((a) => !keys.includes(executionKey(a)))) throw new Error("integration-probes-incomplete");
  const finalized = await client.getBlock({ blockTag: "finalized" });
  for (const probe of input.probes) {
    const [tx, receipt] = await Promise.all([client.getTransaction({ hash: probe.tx_hash }), client.getTransactionReceipt({ hash: probe.tx_hash })]);
    if (receipt.status !== "success" || receipt.blockNumber > finalized.number || tx.to?.toLowerCase() !== input.core.toLowerCase()) {
      throw new Error("integration-probe-transaction-invalid");
    }
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash || block.transactions[receipt.transactionIndex]?.toLowerCase() !== probe.tx_hash.toLowerCase()) {
      throw new Error("integration-probe-transaction-invalid");
    }
    const decoded = decodeFunctionData({ abi: executionCoreAbi, data: tx.input });
    if (decoded.functionName !== "executePlan" || decoded.args[0].toLowerCase() !== probe.credit_id.toLowerCase()) {
      throw new Error("integration-probe-transaction-invalid");
    }
    const credit = await client.readContract({ address: input.core, abi: termbookCoreAbi, functionName: "creditDetails",
      args: [probe.credit_id], blockNumber: block.number });
    if (credit.bundleId.toLowerCase() !== version_id.toLowerCase()) throw new Error("integration-probe-credit-invalid");
    const route = selectCapability(definition.actions, probe.action);
    const marketId = probe.action.params["market_id" as keyof typeof probe.action.params]
      ?? probe.position_state?.market_id ?? route.when?.market_id;
    const market = marketId === undefined && definition.markets.length === 1 ? definition.markets[0]
      : definition.markets.find((m) => String(marketId) === m.market_id);
    if (!market) throw new Error("integration-probe-market-invalid");
    const context: ActionContext = { client, credit_id: probe.credit_id, account: credit.account, borrower: credit.borrower,
      block: { number: block.number, hash: block.hash }, action: probe.action, market,
      minimum_receive: probe.minimum_receive, maximum_spend: probe.maximum_spend, price_bound: probe.price_bound, position_state: probe.position_state };
    const operation = (value.actions as Record<string, { build(context: ActionContext): Promise<unknown> }>)[probe.action.capability];
    if (!operation) throw new Error("integration-definition-mismatch");
    check_plan(definition, probe.action, await operation.build(context), context);
    const expected = buildExecution(route, probe.action, { borrower: credit.borrower, account: credit.account,
      creditId: probe.credit_id, use_case: definition.use_case, priceBound: probe.price_bound ?? probe.minimum_receive ?? probe.maximum_spend,
      state: probe.position_state }, definition.settlement_asset as Address);
    if (canonical(expected) !== canonical(decoded.args[1])) throw new Error("integration-probe-plan-mismatch");
  }
  for (const id of [input.active_credit_id, input.recovered_credit_id]) {
    const credit = await client.readContract({ address: input.core, abi: termbookCoreAbi, functionName: "creditDetails", args: [id], blockNumber: finalized.number });
    if (credit.bundleId.toLowerCase() !== version_id.toLowerCase()) throw new Error("integration-probe-credit-invalid");
    const context = { client, credit_id: id, account: credit.account, block: { number: finalized.number, hash: finalized.hash } };
    const { state } = await assess_state(definition, await value.account.read(context), context);
    for (const holding of state.holdings) {
      if (holding.held_at.toLowerCase() !== credit.account.toLowerCase()) continue;
      const actual = /^0x0{40}$/i.test(holding.asset) ? await client.getBalance({ address: credit.account, blockNumber: finalized.number })
        : await client.readContract({ address: holding.asset as Address, abi: tokenAbi, functionName: "balanceOf", args: [credit.account], blockNumber: finalized.number });
      if (actual !== holding.amount) throw new Error("integration-holding-mismatch");
    }
    if (id === input.recovered_credit_id) {
      const exit = await value.exit.next({ ...context, state: state as never, slippage_bps: 0, minimum_receive: async () => 0n });
      if (exit.status !== "done") throw new Error("integration-recovered-exit-incomplete");
    }
  }
}
function canonical(value: unknown): string {
  return canonicalEvidence(JSON.parse(JSON.stringify(value, (_, item: unknown) => typeof item === "bigint" ? String(item)
    : typeof item === "string" && /^0x[0-9a-f]+$/i.test(item) ? item.toLowerCase() : item)));
}
