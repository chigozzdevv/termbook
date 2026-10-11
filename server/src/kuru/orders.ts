import type { spot, ActionContext, PluginPlan } from "@termbook/sdk";
import { check_plan, check_state } from "@termbook/sdk";
import { pluginDefinitionSchema, selectCapability, capabilityCalls, actionInputs, transformArgument,
  type PluginDefinition, type CapabilityDefinition, type SpotAction } from "@termbook/schema";
import { spotOrderTrackerAbi, useCaseRecoveryAbi } from "@termbook/bindings";
import { encodeFunctionData, parseAbi, parseAbiItem, keccak256, stringToHex, zeroAddress, toFunctionSelector, type Address, type Hex } from "viem";
import { kuru_balance_program, kuru_counter_program, kuru_order_program } from "./read.js";
import type { KuruOptions } from "./integration.js";

const word = (value: bigint | Hex) => typeof value === "bigint" ? `0x${value.toString(16).padStart(64, "0")}` as Hex : value;
const zero = word(0n), max40 = 2n ** 40n - 1n;
const exact = (value: bigint | Hex) => ({ kind: "exact" as const, exact: word(value), minimum: "0", maximum: "0" });
const range = (max: bigint, min = 0n) => ({ kind: "range" as const, exact: zero, minimum: String(min), maximum: String(max) });
const credit = { kind: "credit" as const, exact: zero, minimum: "0", maximum: "0" };
const account = { kind: "account" as const, exact: zero, minimum: "0", maximum: "0" };
const input = (path: string) => ({ source: "input" as const, path });
const constant = (value: Hex | boolean) => ({ source: "constant" as const, value });
const field = (index: bigint) => ({ source: "field" as const, value: word(index) });
const literal = (value: Hex | bigint) => ({ source: "literal" as const, value: word(value) });
const idArgument = { source: "credit_id" as const };
const tokenAbi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
const marginAbi = parseAbi(["function getBalance(address,address) view returns(uint256)"]);

export function create_kuru_orders(options: KuruOptions, atomic: PluginDefinition, shared: {
  contracts: PluginDefinition["contracts"]; order_tracker: Address;
}, margin: Address, size: bigint, price: bigint, tick: bigint, minimumSize: bigint, maximumSize: bigint, makerFee: bigint): spot {
  const market = atomic.markets[0]!, base = market.base_asset as Address, quote = market.quote_asset as Address;
  if (makerFee !== 0n || !/^10*$/.test(String(price)) || price > 10n ** 18n || 10n ** 18n % price !== 0n || tick <= 0n) throw new Error("integration-kuru-market-unsupported");
  const tracker = shared.order_tracker, router = atomic.atomic_spot!.router as Address;
  const baseScale = 10n ** BigInt(market.base_decimals), quoteScale = 10n ** BigInt(market.quote_decimals);
  const quantityLimit = options.max_holding, lot = baseScale / size;
  const maximumQuantity = quantityLimit * size / baseScale < maximumSize ? quantityLimit * size / baseScale : maximumSize;
  if (minimumSize <= 0n || maximumQuantity < minimumSize) throw new Error("integration-kuru-market-unsupported");
  const ids = { buy: keccak256(stringToHex(`${market.market_id}:limit:buy`)), sell: keccak256(stringToHex(`${market.market_id}:limit:sell`)) };
  const balanceProgram = kuru_balance_program();
  const asset = { token: base, oracle: options.oracle, feed_id: options.feed_id, decimals: market.base_decimals,
    maximum: String(options.max_holding), dust: String(options.dust_limit),
    quote: { target: market.address, program: atomic.atomic_spot!.quote_program } };
  const calls: NonNullable<PluginDefinition["assessment"]>["calls"] = [
    { target: router, selector: toFunctionSelector("trade(bytes32,uint256,uint256)"), recovery: true,
      native_maximum: base === zeroAddress ? String(quantityLimit) : "0", ...(base === zeroAddress ? { native_word: 255 } : {}),
      words: [range(2n ** 256n - 1n), range(quantityLimit > options.maximum_input ? quantityLimit : options.maximum_input, 1n), range(2n ** 256n - 1n, 1n)] },
    { target: margin, selector: toFunctionSelector("deposit(address,address,uint256)"), recovery: false,
      native_maximum: base === zeroAddress ? String(quantityLimit) : "0", ...(base === zeroAddress ? { native_word: 255 } : {}),
      words: [account, range(2n ** 160n - 1n), range(quantityLimit > options.maximum_input ? quantityLimit : options.maximum_input, 1n)] },
    { target: tracker, selector: toFunctionSelector("beginOrder(bytes32,bytes32,uint256,uint256)"), recovery: false, native_maximum: "0",
      words: [credit, range(2n ** 256n - 1n), range(quantityLimit, 1n), range(2n ** 32n - 1n, 1n)] },
    { target: tracker, selector: toFunctionSelector("finishOrder(bytes32)"), recovery: false, native_maximum: "0", words: [credit] },
    { target: market.address, selector: toFunctionSelector("addBuyOrder(uint32,uint96,bool)"), recovery: false, native_maximum: "0",
      words: [range(2n ** 32n - 1n, 1n), range(maximumQuantity, minimumSize), exact(0n)] },
    { target: market.address, selector: toFunctionSelector("addSellOrder(uint32,uint96,bool)"), recovery: false, native_maximum: "0",
      words: [range(2n ** 32n - 1n, 1n), range(maximumQuantity, minimumSize), exact(0n)] },
    { target: tracker, selector: toFunctionSelector("beginCancel(bytes32,address,uint256)"), recovery: true, native_maximum: "0",
      words: [credit, exact(word(BigInt(market.address))), range(max40, 1n)] },
    { target: market.address, selector: toFunctionSelector("batchCancelOrders(uint40[])"), recovery: true, native_maximum: "0",
      words: [exact(32n), exact(1n), range(max40, 1n)] },
    { target: margin, selector: toFunctionSelector("withdraw(uint256,address)"), recovery: true, native_maximum: "0",
      words: [range(quantityLimit > options.maximum_input ? quantityLimit : options.maximum_input, 1n), range(2n ** 160n - 1n)] },
  ];
  const actions: CapabilityDefinition[] = [...atomic.actions];
  for (const direction of ["buy", "sell"] as const) for (const sizing of ["spend", "receive"] as const) {
    const token = direction === "buy" ? quote : base;
    actions.push({ capability: "place_order", executionKey: `kuru_limit_${direction}_${sizing}`, label: direction === "buy" ? "Limit buy" : "Limit sell",
      settlement: "asynchronous", expiry: "none", when: { market_id: market.market_id, direction, order_type: "limit", sizing },
      target: tracker, signature: "function finishOrder(bytes32)", arguments: [idArgument],
      steps: [
        { target: margin, signature: "function deposit(address,address,uint256) payable", arguments: [{ source: "credit_account" }, constant(token), input("_derived.order_spend")],
          ...(token === zeroAddress ? { valuePath: "_derived.order_spend" } : { spendPath: "_derived.order_spend", spendToken: token }),
          ...(direction === "buy" ? { fundingPath: "_derived.order_spend" } : {}) },
        { target: tracker, signature: "function beginOrder(bytes32,bytes32,uint256,uint256)",
          arguments: [idArgument, constant(ids[direction]), input("_derived.order_quantity"), { source: "price_bound" }] },
        { target: market.address, signature: `function add${direction === "buy" ? "Buy" : "Sell"}Order(uint32,uint96,bool)`,
          arguments: [{ source: "price_bound" }, { ...input("_derived.order_quantity"), scale: { numerator: String(size), denominator: String(baseScale) },
            min: String(minimumSize), max: String(maximumQuantity) }, constant(false)] },
      ], marketPath: "market_id", orderSizing: { baseAsset: base, quoteAsset: quote, baseDecimals: market.base_decimals,
        quoteDecimals: market.quote_decimals, feeBps: 0, lotSize: String(lot) },
      price: { kind: "price", directionPath: "direction", maximumDirections: ["buy"], minimumDirections: ["sell"], markets: [keccak256(stringToHex(market.market_id))] } });
  }
  actions.push({ capability: "cancel_order", executionKey: "kuru_cancel", label: "Cancel order", settlement: "atomic",
    target: market.address, signature: "function batchCancelOrders(uint40[])", arguments: [{ ...input("order_id"), singleton: true }],
    steps: [{ target: tracker, signature: "function beginCancel(bytes32,address,uint256)", arguments: [idArgument, constant(market.address as Hex), input("order_id")] }] });
  const assessment: NonNullable<PluginDefinition["assessment"]> = {
    read_program: atomic.atomic_spot!.quote_source, state_target: zeroAddress, reads: {}, assets: [asset],
    markets: [{ market_id: market.market_id, receipt: zeroAddress, asset0: asset, maximum_exposure: String(options.maximum_input) }],
    retained_bps: options.retained_bps, recovery_costs: String(options.recovery_costs), max_positions: 3, max_pending: 8, max_requests: 0,
    routes: { router, values: atomic.atomic_spot!.routes },
    orders: { tracker, rules: (["buy", "sell"] as const).map((direction) => ({ id: ids[direction], market_id: market.market_id,
      target: market.address, input: direction === "buy" ? quote : base, custody: margin,
      counter: kuru_counter_program(), state: kuru_order_program(size, price, BigInt(market.base_decimals), BigInt(market.quote_decimals)), balance: balanceProgram,
      maximum_input: String(direction === "buy" ? options.maximum_input : quantityLimit), maximum_quantity: String(quantityLimit), buy: direction === "buy" })) },
    custody: [base, quote].map((token) => ({ target: margin, program: balanceProgram, token,
      maximum: String(token === quote ? 2n ** 128n - 1n : quantityLimit), dust: "0" })),
    action_limits: actions.map((a) => ({ action: a.executionKey!, maximum_input: String(a.when?.direction === "buy" ? options.maximum_input : 0n),
      maximum_exposure: String(a.when?.direction === "buy" ? options.maximum_input : 0n) })),
    calls, recovery: [
      { phase: "pending", market_id: market.market_id, target: tracker, selector: toFunctionSelector("beginCancel(bytes32,address,uint256)"),
        words: [{ source: "credit", value: zero }, literal(word(BigInt(market.address))), field(7n)], input: zeroAddress, output: quote,
        asynchronous: true, pending_status: 1 },
      { phase: "pending", market_id: market.market_id, target: market.address, selector: toFunctionSelector("batchCancelOrders(uint40[])"),
        words: [literal(32n), literal(1n), field(7n)], input: zeroAddress, output: quote, asynchronous: true, pending_status: 2 },
      ...[base, quote].map((token) => ({ phase: "custody" as const, market_id: token, target: margin, selector: toFunctionSelector("withdraw(uint256,address)"),
        words: [field(1n), literal(word(BigInt(token)))], input: zeroAddress, output: token, minimum_field: 1, asynchronous: false })),
      { phase: "holding", market_id: base, target: router, selector: toFunctionSelector("trade(bytes32,uint256,uint256)"),
        words: [literal(atomic.atomic_spot!.routes[1]!.id as Hex), field(1n), { source: "minimum", value: zero }], input: base, output: quote,
        spend_field: 1, minimum_field: 2, asynchronous: false },
    ], prices: actions.filter((a) => a.price).map((a) => {
      const limit = a.when?.order_type === "limit", buy = a.when?.direction === "buy";
      return { action: a.executionKey!, market_id: market.market_id, oracle: options.oracle, feed_id: options.feed_id,
        target: limit ? tracker : router, selector: toFunctionSelector(limit ? "beginOrder(bytes32,bytes32,uint256,uint256)" : "trade(bytes32,uint256,uint256)"),
        call_index: limit ? 1 : 0, price_decimals: limit ? String(price).length - 1 : buy ? market.base_decimals : market.quote_decimals,
        price_word: limit ? 3 : 2, direction_word: limit ? 1 : 0,
        maximum_direction: String(BigInt(limit ? ids.buy : atomic.atomic_spot!.routes[0]!.id)),
        minimum_direction: String(BigInt(limit ? ids.sell : atomic.atomic_spot!.routes[1]!.id)),
        max_slippage_bps: 100, max_deviation_bps: 500, max_authorization_age: 90,
        ...(!limit ? { amount: { word: 1, input_decimals: buy ? market.quote_decimals : market.base_decimals,
          output_decimals: buy ? market.base_decimals : market.quote_decimals, inverse: buy, max_input: false, input: buy ? quote : base, output: buy ? base : quote } } : {}) };
    }),
  };
  const { atomic_spot: _atomic, ...rest } = atomic;
  const definition = pluginDefinitionSchema.parse({ ...rest, contracts: shared.contracts, actions, assessment });
  const contextBound = (context: ActionContext<SpotAction>) => context.action.capability === "place_order" && context.action.params.order_type === "limit"
    ? BigInt(String(context.action.params.limit_price)) * price / 10n ** 18n : context.minimum_receive;
  const build = async (context: ActionContext<SpotAction>): Promise<PluginPlan> => {
    const route = selectCapability(definition.actions, context.action), inputs = actionInputs(route, context.action);
    const bound = contextBound(context);
    if (context.action.capability === "place_order" && context.action.params.order_type === "limit") {
      if (!bound || bound % tick !== 0n || BigInt(String(context.action.params.limit_price)) * price % 10n ** 18n !== 0n) throw new Error("integration-order-price-invalid");
    }
    const at = (path: string): unknown => path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], inputs);
    const planCalls = capabilityCalls(route).map((call) => {
      const fn = parseAbiItem(call.signature);
      if (fn.type !== "function") throw new Error("integration-action-invalid");
      const args = call.arguments.map((a) => a.source === "constant" ? a.value : a.source === "credit_id" ? context.credit_id
        : a.source === "credit_account" ? context.account : a.source === "price_bound" ? bound : transformArgument(a, at(a.path!)));
      const spend = call.spendPath ? BigInt(String(at(call.spendPath))) : 0n;
      return { target: call.target as Address, data: encodeFunctionData({ abi: [fn], functionName: fn.name, args: args as never }),
        value: call.valuePath ? BigInt(String(at(call.valuePath))) : 0n, spend_asset: spend > 0n ? call.spendToken as Address : zeroAddress, spend_amount: spend };
    });
    const budgets = new Map<Address, bigint>();
    for (const call of planCalls) {
      if (call.value) budgets.set(zeroAddress, (budgets.get(zeroAddress) ?? 0n) + call.value);
      if (call.spend_amount) budgets.set(call.spend_asset, (budgets.get(call.spend_asset) ?? 0n) + call.spend_amount);
    }
    const deadline = route.settlement === "asynchronous" ? Number(await context.client.readContract({ address: tracker,
      abi: spotOrderTrackerAbi, functionName: "deadline", args: [context.credit_id], blockNumber: context.block.number })) : 0;
    return check_plan(definition, context.action, { calls: planCalls, spending: [...budgets].map(([asset, maximum]) => ({ asset, maximum })),
      receiving: context.action.capability === "place_order" && context.action.params.order_type === "market"
        ? [{ asset: context.action.params.direction === "buy" ? base : quote, minimum: bound!, controlled_by: context.account }] : [],
      completion: route.settlement === "atomic" ? { kind: "atomic" } : { kind: "pending", deadline,
        tracking: { target: tracker, event: "OrderCaptured(bytes32,bytes32,uint256)" } } }, { ...context, price_bound: bound });
  };
  return { name: definition.name, use_case: "spot", chain_id: definition.chain_id, markets: definition.markets, definition,
    actions: { place_order: { build }, cancel_order: { build } },
    account: { async read(context) {
      const holdings = await Promise.all([base, quote].flatMap((asset) => [context.account, margin].map(async (held_at) => {
        const amount = held_at === margin ? await context.client.readContract({ address: margin, abi: marginAbi, functionName: "getBalance", args: [context.account, asset], blockNumber: context.block.number })
          : asset === zeroAddress ? await context.client.getBalance({ address: context.account, blockNumber: context.block.number })
            : await context.client.readContract({ address: asset, abi: tokenAbi, functionName: "balanceOf", args: [context.account], blockNumber: context.block.number });
        return { holding_id: `${held_at}:${asset}`, asset, amount, held_at, controlled_by: context.account, withdrawable_now: amount };
      })));
      const count = Number(await context.client.readContract({ address: tracker, abi: spotOrderTrackerAbi, functionName: "count", args: [context.credit_id], blockNumber: context.block.number }));
      if (count > 32) throw new Error("integration-order-count-invalid");
      const orders = await Promise.all(Array.from({ length: count }, async (_, index) => {
        const [pendingId, state] = await context.client.readContract({ address: tracker, abi: spotOrderTrackerAbi, functionName: "at", args: [context.credit_id, BigInt(index)], blockNumber: context.block.number });
        const [, inputAsset, venueId] = await context.client.readContract({ address: tracker, abi: spotOrderTrackerAbi, functionName: "details", args: [context.credit_id, pendingId], blockNumber: context.block.number });
        const buy = inputAsset.toLowerCase() === quote.toLowerCase();
        return { order_id: String(venueId), market_id: market.market_id, owner: context.account, direction: buy ? "buy" as const : "sell" as const,
          input_asset: inputAsset, remaining_input: state.remaining, filled_input: state.filled,
          output_asset: buy ? base : quote, ...(state.filled === 0n ? { filled_output: 0n } : {}), exposure: 0n,
          status: state.status === 2 ? "cancel_requested" as const : state.filled > 0n ? "partially_filled" as const : "open" as const };
      }));
      return check_state("spot", { block: context.block, holdings, orders, liabilities: [] }, context);
    } }, exit: { async next(context) {
      const [step_id, instruction, retry] = await context.client.readContract({ address: definition.contracts.recovery as Address,
        abi: useCaseRecoveryAbi, functionName: "nextExitStep", args: [context.credit_id, context.account], blockNumber: context.block.number });
      if (step_id === zero) return retry > 0n ? { status: "wait", retry_at: Number(retry), tracking_id: context.credit_id } : { status: "done" };
      const [target, data, value] = await context.client.readContract({ address: definition.contracts.recovery as Address, abi: useCaseRecoveryAbi,
        functionName: "recoveryCall", args: [context.credit_id, context.account, instruction], blockNumber: context.block.number });
      const [asset, amount] = await context.client.readContract({ address: definition.contracts.recovery as Address, abi: useCaseRecoveryAbi,
        functionName: "recoverySpend", args: [context.credit_id, context.account, instruction], blockNumber: context.block.number });
      return { status: "execute", step_id, plan: { calls: [{ target, data, value, spend_asset: asset, spend_amount: amount }],
        spending: value > 0n ? [{ asset: zeroAddress, maximum: value }] : amount > 0n ? [{ asset, maximum: amount }] : [], receiving: [], completion: { kind: "atomic" } } };
    } } };
}
