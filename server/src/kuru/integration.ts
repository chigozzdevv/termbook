import type { spot, ActionContext, PluginPlan, ExitContext } from "@termbook/sdk";
import { pin_contract, check_state, check_plan, package_integration } from "@termbook/sdk";
import { canonicalEvidence, pluginDefinitionSchema, type PluginDefinition, type CapabilityDefinition } from "@termbook/schema";
import { encodeAbiParameters, encodeFunctionData, parseAbi, keccak256, stringToHex, zeroAddress,
  toFunctionSelector, type Address, type Hex, type PublicClient } from "viem";
import { create_kuru_orders } from "./orders.js";
import { kuru_quote_program } from "./read.js";

const marketAbi = parseAbi([
  "function getMarketParams() view returns (uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)",
  "function marketState() view returns (uint8)",
  "function isTrustedForwarder(address) view returns (bool)",
  "function kuruAmmVault() view returns(address)",
]);
const vaultAbi = parseAbi(["function owner() view returns(address)", "function market() view returns(address)", "function marginAccount() view returns(address)"]);
const factoryAbi = parseAbi(["function marginAccountAddress() view returns(address)", "function TRUSTED_FORWARDER() view returns(address)"]);
const routerAbi = parseAbi(["function trade(bytes32 routeId,uint256 amountIn,uint256 minimumOut) payable returns (uint256)"]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const UINT96 = 2n ** 96n - 1n;
export type KuruOptions = {
  client: PublicClient; market_address: Address; settlement_asset: Address; api_base?: string;
  maximum_input: bigint; retained_bps: number; recovery_costs: bigint; max_holding: bigint; dust_limit: bigint;
  oracle: Address; feed_id: Hex;
};

export class KuruSourceUnavailableError extends Error {
  constructor(readonly failures: { target: Address; implementation?: Address; reason: string }[]) {
    super("integration-kuru-sources-unavailable");
  }
}

async function json<T>(api: string, path: string): Promise<T> {
  const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    const reason = typeof body?.error === "string" && /^integration-[a-z-]+$/.test(body.error) ? body.error
      : path.startsWith("/integrations/source") ? "integration-source-unavailable" : "integration-platform-unavailable";
    throw new Error(reason);
  }
  return response.json() as Promise<T>;
}

export async function create_kuru(options: KuruOptions): Promise<spot> {
  const amount = (value: bigint) => {
    if (!/^\d{1,78}$/.test(String(value)) || BigInt(value) >= 2n ** 128n) throw new Error("integration-kuru-limits-invalid");
    return BigInt(value);
  };
  options = { ...options, maximum_input: amount(options.maximum_input), recovery_costs: amount(options.recovery_costs),
    max_holding: amount(options.max_holding), dust_limit: amount(options.dust_limit) };
  if (options.maximum_input === 0n || options.max_holding === 0n || options.dust_limit > options.max_holding
    || !Number.isSafeInteger(options.retained_bps) || options.retained_bps <= 0 || options.retained_bps > 10_000) throw new Error("integration-kuru-limits-invalid");
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const api = new URL(options.api_base ?? runtime.process?.env?.["TERMBOOK_PUBLIC_API_BASE"] ?? "");
  if (api.protocol !== "https:" && !(api.protocol === "http:" && ["localhost", "127.0.0.1"].includes(api.hostname))
    || api.username || api.password || api.search || api.hash || api.pathname !== "/") throw new Error("integration-api-invalid");
  const client = options.client;
  const platform = await json<{ chain_id: number; router: Address; module: Address; read_program: Address;
    contracts?: PluginDefinition["contracts"]; order_tracker?: Address; health?: { factory: Address; collateral: Address } }>(api.origin, "/integrations/platform/spot");
  const chain_id = await client.getChainId();
  if (chain_id !== platform.chain_id) throw new Error("integration-chain-mismatch");
  const block = await client.getBlock({ blockTag: "finalized" });
  const params = await client.readContract({ address: options.market_address, abi: marketAbi, functionName: "getMarketParams", blockNumber: block.number });
  const [price, size, base, baseDecimals, quote, quoteDecimals] = params;
  if (quote.toLowerCase() !== options.settlement_asset.toLowerCase() || quote === zeroAddress || base === quote
    || price <= 0 || size <= 0n || baseDecimals > 36n || quoteDecimals > 36n
    || 10n ** baseDecimals % size !== 0n
    || (10n ** quoteDecimals % BigInt(price) !== 0n && BigInt(price) % 10n ** quoteDecimals !== 0n)) {
    throw new Error("integration-kuru-market-unsupported");
  }
  if (await client.readContract({ address: options.market_address, abi: marketAbi, functionName: "isTrustedForwarder",
    args: [platform.router], blockNumber: block.number })) throw new Error("integration-forwarder-unsafe");
  const vault = await client.readContract({ address: options.market_address, abi: marketAbi, functionName: "kuruAmmVault", blockNumber: block.number });
  const [factory, vaultMarket, margin] = await Promise.all((["owner", "market", "marginAccount"] as const).map((functionName) =>
    client.readContract({ address: vault, abi: vaultAbi, functionName, blockNumber: block.number })));
  const [factoryMargin, forwarder] = await Promise.all((["marginAccountAddress", "TRUSTED_FORWARDER"] as const).map((functionName) =>
    client.readContract({ address: factory, abi: factoryAbi, functionName, blockNumber: block.number })));
  if (vaultMarket.toLowerCase() !== options.market_address.toLowerCase() || margin.toLowerCase() !== factoryMargin.toLowerCase()
    || [vault, factory, margin, forwarder].some((a) => a === zeroAddress)
    || !await client.readContract({ address: options.market_address, abi: marketAbi, functionName: "isTrustedForwarder",
      args: [forwarder], blockNumber: block.number })) throw new Error("integration-kuru-dependency-mismatch");
  const market = { market_id: options.market_address.toLowerCase(), address: options.market_address,
    base_asset: base, quote_asset: quote, base_decimals: Number(baseDecimals), quote_decimals: Number(quoteDecimals) };
  const targets = [...new Set([platform.router, platform.module, platform.read_program, options.market_address,
    vault, factory, margin, forwarder, base, quote, options.oracle,
    ...platform.health ? [platform.health.factory, platform.health.collateral] : [],
    ...platform.order_tracker ? [platform.order_tracker, ...Object.values(platform.contracts ?? {})] : []].filter((address) => address !== zeroAddress).map((address) => address.toLowerCase()))] as Address[];
  const pins = await Promise.all(targets.map((target) => pin_contract(client, target, block.number)));
  const sourceResults = await Promise.allSettled(pins.map(async (pin) => {
    const source = await json<PluginDefinition["verified_sources"][number] & { code_hash: Hex; implementation_code_hash?: Hex }>(api.origin,
      `/integrations/source?target=${pin.target}`);
    if (source.target.toLowerCase() !== pin.target.toLowerCase() || source.code_hash.toLowerCase() !== pin.code_hash.toLowerCase()
      || source.implementation?.toLowerCase() !== pin.implementation?.toLowerCase()
      || source.implementation_code_hash?.toLowerCase() !== pin.implementation_code_hash?.toLowerCase()) throw new Error("integration-source-pin-mismatch");
    return { target: source.target, source_hash: source.source_hash, implementation: source.implementation,
      implementation_source_hash: source.implementation_source_hash,
      ...(source.implementation_runtime_review ? { implementation_runtime_review: source.implementation_runtime_review } : {}) };
  }));
  const failures = sourceResults.flatMap((result, index) => result.status === "rejected" ? [{
    target: pins[index]!.target as Address, implementation: pins[index]!.implementation as Address | undefined,
    reason: result.reason instanceof Error ? result.reason.message : "integration-source-unavailable",
  }] : []);
  if (failures.length) throw new KuruSourceUnavailableError(failures);
  const verified_sources = sourceResults.map((result) => {
    if (result.status !== "fulfilled") throw new Error("integration-source-unavailable");
    return result.value;
  });
  const routes = (["buy", "sell"] as const).map((direction) => {
    const id = keccak256(stringToHex(canonicalEvidence({ protocol: "kuru", direction, market, pins, verified_sources,
      retained_bps: options.retained_bps, recovery_costs: String(options.recovery_costs), maximum_input: String(options.maximum_input), max_holding: String(options.max_holding), dust_limit: String(options.dust_limit) })));
    return { id, target: options.market_address, input: direction === "buy" ? quote : base, output: direction === "buy" ? base : quote,
      selector: toFunctionSelector(direction === "buy" ? "placeAndExecuteMarketBuy(uint96,uint256,bool,bool)" : "placeAndExecuteMarketSell(uint96,uint256,bool,bool)"),
      amount_word: 0, minimum_word: 1, numerator: String(direction === "buy" ? price : size),
      denominator: String(10n ** (direction === "buy" ? quoteDecimals : baseDecimals)),
      minimum_size: "1", maximum_size: String(UINT96), words: [zeroWord(), zeroWord(), zeroWord(), oneWord()] };
  });
  const marketWord = keccak256(stringToHex(market.market_id));
  const actions: CapabilityDefinition[] = (["buy", "sell"] as const).map((direction, index) => {
    const native = routes[index]!.input === zeroAddress;
    return { capability: "place_order", executionKey: `kuru_${direction}`, label: direction === "buy" ? "Buy" : "Sell", settlement: "atomic",
      when: { market_id: market.market_id, direction, order_type: "market", sizing: "spend" },
      target: platform.router, signature: "function trade(bytes32 routeId,uint256 amountIn,uint256 minimumOut) payable returns (uint256)",
      arguments: [{ source: "constant", value: routes[index]!.id }, { source: "input", path: "amount.spend", min: "1" }, { source: "price_bound" }],
      ...(native ? { valuePath: "amount.spend" } : { spendPath: "amount.spend", spendToken: routes[index]!.input }),
      ...(direction === "buy" ? { fundingPath: "amount.spend" } : {}), marketPath: "market_id",
      price: { kind: "min_output", amountPath: "amount.spend", slippagePath: "slippage_bps", markets: [marketWord] } };
  });
  const parameter_hash = keccak256(encodeAbiParameters(marketAbi[0].outputs, params));
  const definition = pluginDefinitionSchema.parse({ format: 1, name: "Kuru Spot", use_case: "spot", chain_id,
    settlement_asset: quote, markets: [market], actions,
    contracts: { execution: platform.module, reader: platform.module, recovery: platform.module, exit: platform.module },
    pins, verified_sources, atomic_spot: { router: platform.router, module: platform.module,
      quote_source: platform.read_program, oracle: options.oracle, feed_id: options.feed_id,
      maximum_input: String(options.maximum_input), quote_program: kuru_quote_program(parameter_hash, size, BigInt(price), baseDecimals, quoteDecimals), retained_bps: options.retained_bps,
      recovery_costs: String(options.recovery_costs), max_holding: String(options.max_holding), dust_limit: String(options.dust_limit), routes } });

  const build = async (context: ActionContext<Extract<import("@termbook/schema").SpotAction, { capability: "place_order" }>>): Promise<PluginPlan> => {
    const action = context.action;
    if (action.params.order_type !== "market" || !("spend" in action.params.amount)
      || action.params.market_id !== market.market_id || context.market.market_id !== market.market_id
      || context.minimum_receive === undefined || context.minimum_receive <= 0n) throw new Error("capability-denied");
    const index = action.params.direction === "buy" ? 0 : 1;
    const route = routes[index]!;
    const amount = BigInt(action.params.amount.spend);
    const encoded = amount * BigInt(route.numerator) / BigInt(route.denominator);
    if (encoded === 0n || encoded > UINT96) throw new Error("integration-order-size-invalid");
    const plan: PluginPlan = { calls: [{ target: platform.router,
      data: encodeFunctionData({ abi: routerAbi, functionName: "trade", args: [route.id, amount, context.minimum_receive] }),
      value: route.input === zeroAddress ? amount : 0n,
      spend_asset: route.input === zeroAddress ? zeroAddress : route.input, spend_amount: route.input === zeroAddress ? 0n : amount }],
      spending: [{ asset: route.input, maximum: amount }], receiving: [{ asset: route.output, minimum: context.minimum_receive, controlled_by: context.account }],
      completion: { kind: "atomic" } };
    return check_plan(definition, action, plan, context);
  };
  if (platform.order_tracker) {
    if (!platform.contracts) throw new Error("integration-platform-unavailable");
    const plugin = create_kuru_orders(options, definition, { order_tracker: platform.order_tracker, contracts: platform.contracts },
      margin, size, BigInt(price), BigInt(params[6]), BigInt(params[7]), BigInt(params[8]), params[10]);
    package_integration(plugin);
    return plugin;
  }
  const plugin: spot = { name: definition.name, use_case: "spot", chain_id, markets: [market], definition,
    account: { async read(context) {
      const holdings = await Promise.all([base, quote].map(async (asset) => {
        const amount = asset === zeroAddress ? await context.client.getBalance({ address: context.account, blockNumber: context.block.number })
          : await context.client.readContract({ address: asset, abi: tokenAbi, functionName: "balanceOf", args: [context.account], blockNumber: context.block.number });
        return { holding_id: asset.toLowerCase(), asset, amount, held_at: context.account, controlled_by: context.account, withdrawable_now: amount };
      }));
      return check_state("spot", { block: context.block, holdings, orders: [], liabilities: [] }, context);
    } }, actions: { place_order: { build } }, exit: { async next(context: ExitContext<"spot">) {
      const state = check_state("spot", context.state, context);
      if (state.orders.length || state.liabilities.length) return { status: "blocked", reason: "unexpected-venue-obligation" };
      const holding = state.holdings.find((item) => item.asset.toLowerCase() === base.toLowerCase());
      if (!holding || holding.amount <= options.dust_limit || holding.amount * size / 10n ** baseDecimals === 0n) return { status: "done" };
      const amount = holding.amount < UINT96 * (10n ** baseDecimals / size) ? holding.amount : UINT96 * (10n ** baseDecimals / size);
      const minimum = await context.minimum_receive(market.market_id, base, amount);
      if (minimum <= 0n) return { status: "blocked", reason: "recovery-liquidity-unavailable" };
      const plan = await build({ ...context, borrower: context.account, market, minimum_receive: minimum,
        action: { use_case: "spot", capability: "place_order", params: { market_id: market.market_id, direction: "sell",
          order_type: "market", amount: { spend: amount }, slippage_bps: context.slippage_bps } } });
      return { status: "execute", step_id: keccak256(stringToHex(`${context.credit_id}:${context.block.hash}:${amount}`)), plan };
    } } };
  package_integration(plugin);
  return plugin;
}

const zeroWord = () => `0x${"0".repeat(64)}` as Hex;
const oneWord = () => `0x${"0".repeat(63)}1` as Hex;
