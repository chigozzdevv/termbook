import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";
import { capabilityDefinitionSchema, assertActionRoutes, capabilityDependencies } from "./integration.js";
import { assertStandardDefinition } from "./action-definition.js";
import { useCaseSchema } from "./actions.js";
import { assessmentSchema } from "./assessment.js";
import { readProgramSchema, queryDerived } from "./read-program.js";

const address = addressSchema.refine((v) => !/^0x0{40}$/i.test(v));
const word = bytes32Schema.refine((v) => !/^0x0{64}$/i.test(v));
export const pluginMarketSchema = z.strictObject({
  market_id: z.string().min(1).max(128), address,
  base_asset: addressSchema, quote_asset: addressSchema,
  base_decimals: z.number().int().min(0).max(36), quote_decimals: z.number().int().min(0).max(36),
}).refine((v) => v.base_asset.toLowerCase() !== v.quote_asset.toLowerCase(), "integration-assets-identical");

export const pluginPinSchema = z.strictObject({
  target: address, code_hash: word,
  implementation: address.optional(), implementation_code_hash: word.optional(),
  implementation_slot: word.optional(),
}).refine((v) => v.implementation === undefined
  ? v.implementation_code_hash === undefined && v.implementation_slot === undefined
  : v.implementation_code_hash !== undefined && v.implementation_slot !== undefined, "integration-implementation-pin-incomplete");

export const pluginDefinitionSchema = z.strictObject({
  format: z.literal(1), name: z.string().trim().min(1).max(80),
  use_case: useCaseSchema, chain_id: z.number().int().positive(), settlement_asset: address,
  markets: z.array(pluginMarketSchema).min(1).max(32),
  actions: z.array(capabilityDefinitionSchema).min(1).max(32),
  contracts: z.strictObject({ execution: address, reader: address, recovery: address, exit: address }),
  pins: z.array(pluginPinSchema).min(1).max(64),
  verified_sources: z.array(z.strictObject({
    target: address, source_hash: word, implementation: address.optional(), implementation_source_hash: word.optional(),
  })).min(1).max(64),
  assessment: assessmentSchema.optional(),
  atomic_spot: z.strictObject({
    router: address, module: address, quote_source: address, oracle: address, feed_id: word,
    quote_program: readProgramSchema.refine((program) => program.outputs.length === 2 && queryDerived(program, program.outputs[1]!), "integration-quote-outputs-invalid"),
    retained_bps: z.number().int().min(1).max(10000),
    recovery_costs: z.string().regex(/^\d{1,39}$/), maximum_input: z.string().regex(/^[1-9]\d{0,38}$/), max_holding: z.string().regex(/^[1-9]\d{0,38}$/), dust_limit: z.string().regex(/^\d{1,39}$/),
    routes: z.array(z.strictObject({
      id: word, target: address, input: addressSchema, output: addressSchema,
      selector: z.string().regex(/^0x[a-fA-F0-9]{8}$/),
      amount_word: z.number().int().min(0).max(23), minimum_word: z.number().int().min(0).max(23),
      numerator: z.string().regex(/^[1-9]\d{0,77}$/), denominator: z.string().regex(/^[1-9]\d{0,77}$/),
      minimum_size: z.string().regex(/^[1-9]\d{0,28}$/), maximum_size: z.string().regex(/^[1-9]\d{0,28}$/),
      words: z.array(bytes32Schema).min(1).max(24),
    })).length(2),
  }).optional(),
}).superRefine((v, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const required = { spot: ["place_order"], perps: ["place_order", "close_position"], vault: ["deposit_vault"],
    staking: ["stake"], liquidity: ["add_liquidity"] }[v.use_case];
  if (required.some((capability) => !v.actions.some((a) => a.capability === capability))) issue("integration-lifecycle-incomplete");
  const markets = v.markets.map((m) => m.market_id);
  const targets = v.pins.map((p) => p.target.toLowerCase());
  if (new Set(markets).size !== markets.length || new Set(targets).size !== targets.length) issue("integration-definition-duplicate");
  const dependencies = v.actions.flatMap(capabilityDependencies).map((c) => c.target.toLowerCase());
  const sources = v.verified_sources.map((s) => s.target.toLowerCase());
  if (new Set(sources).size !== sources.length || sources.length !== targets.length
    || targets.some((d) => !sources.includes(d))) issue("integration-source-evidence-incomplete");
  for (const target of [...Object.values(v.contracts), ...dependencies,
    ...v.markets.flatMap((m) => [m.address, m.base_asset, m.quote_asset]), v.settlement_asset]) {
    if (!/^0x0{40}$/i.test(target) && !targets.includes(target.toLowerCase())) issue("integration-target-unpinned");
  }
  for (const source of v.verified_sources) {
    const pin = v.pins.find((p) => p.target.toLowerCase() === source.target.toLowerCase());
    if (pin?.implementation?.toLowerCase() !== source.implementation?.toLowerCase()
      || Boolean(source.implementation) !== Boolean(source.implementation_source_hash)) issue("integration-source-pin-mismatch");
  }
  if (v.assessment) {
    const a = v.assessment;
    if (v.atomic_spot || v.contracts.exit.toLowerCase() !== v.contracts.recovery.toLowerCase()
      || v.use_case !== "spot" && (!a.reads.meta || !a.reads.position)
      || v.use_case === "liquidity" && a.markets.some((m) => !m.asset1)) issue("integration-assessment-invalid");
    const assets = [...a.assets, ...a.markets.flatMap((m) => [m.asset0, ...(m.asset1 ? [m.asset1] : [])])];
    const programs = [...Object.values(a.reads), ...assets.map((asset) => asset.quote?.program)].filter((p) => p !== undefined);
    const additional = [a.read_program, a.state_target, ...assets.flatMap((asset) => [asset.token, asset.oracle, asset.quote?.target ?? "0x" + "0".repeat(40)]),
      ...a.calls.map((c) => c.target), ...a.recovery.flatMap((r) => [r.target, r.input, r.output]), ...a.prices.flatMap((p) => [p.oracle, p.target]),
      ...programs.flatMap((p) => p.queries.map((q) => q.target))];
    if (additional.some((target) => !/^0x0{40}$/i.test(target) && !targets.includes(target.toLowerCase()))) issue("integration-target-unpinned");
    if (a.markets.some((m) => !markets.includes(m.market_id)) || a.assets.some((asset) => asset.token.toLowerCase() === v.settlement_asset.toLowerCase())) issue("integration-assessment-invalid");
    if (a.action_limits.length !== v.actions.length || v.actions.some((action) => !a.action_limits.some((limit) => limit.action === (action.executionKey ?? action.capability)))) issue("integration-action-limits-incomplete");
    if (v.actions.some((action) => action.price && !a.prices.some((p) => p.action === (action.executionKey ?? action.capability)))
      || a.prices.some((p) => !v.actions.some((action) => p.action === (action.executionKey ?? action.capability) && action.price))) issue("integration-price-rules-incomplete");
  }
  if (v.atomic_spot) {
    const spot = v.atomic_spot;
    if (spot.quote_program.queries.some((query) => !/^0x0{40}$/i.test(query.target) && !targets.includes(query.target.toLowerCase()))) issue("integration-target-unpinned");
    if (v.use_case !== "spot" || v.markets.length !== 1 || v.actions.length !== 2
      || spot.module.toLowerCase() !== v.contracts.execution.toLowerCase()
      || Object.values(v.contracts).some((target) => target.toLowerCase() !== spot.module.toLowerCase())
      || !targets.includes(spot.quote_source.toLowerCase()) || !targets.includes(spot.router.toLowerCase()) || !targets.includes(spot.oracle.toLowerCase())
      || BigInt(spot.maximum_input) >= 2n ** 128n || BigInt(spot.max_holding) > 2n ** 128n - 1n || BigInt(spot.recovery_costs) > 2n ** 128n - 1n
      || BigInt(spot.dust_limit) >= BigInt(spot.max_holding)) issue("integration-spot-definition-invalid");
    for (const route of spot.routes) {
      if (route.amount_word === route.minimum_word || route.amount_word >= route.words.length || route.minimum_word >= route.words.length
        || !/^0x0{64}$/i.test(route.words[route.amount_word] ?? "") || !/^0x0{64}$/i.test(route.words[route.minimum_word] ?? "")
        || !targets.includes(route.target.toLowerCase()) || BigInt(route.minimum_size) > BigInt(route.maximum_size)
        || BigInt(route.maximum_size) >= 2n ** 96n || BigInt(route.numerator) >= 2n ** 256n || BigInt(route.denominator) >= 2n ** 256n) issue("integration-spot-route-invalid");
    }
    const market = v.markets[0];
    if (market && (market.quote_asset.toLowerCase() !== v.settlement_asset.toLowerCase()
      || new Set(spot.routes.map((r) => r.id.toLowerCase())).size !== 2)) issue("integration-spot-route-invalid");
    for (const direction of ["buy", "sell"] as const) {
      const actions = v.actions.filter((a) => a.when?.direction === direction);
      const route = spot.routes.find((r) => (direction === "buy" ? r.input : r.output).toLowerCase() === v.settlement_asset.toLowerCase());
      const action = actions[0];
      if (actions.length !== 1 || !market || !route || !action || action.capability !== "place_order"
        || action.settlement !== "atomic" || action.when?.order_type !== "market" || action.when.sizing !== "spend"
        || action.when.market_id !== market.market_id || action.target.toLowerCase() !== spot.router.toLowerCase()
        || (direction === "buy" ? route.output : route.input).toLowerCase() !== market.base_asset.toLowerCase()
        || route.target.toLowerCase() !== market.address.toLowerCase()
        || action.arguments.length !== 3 || action.arguments[0]?.source !== "constant"
        || String(action.arguments[0].value).toLowerCase() !== route.id.toLowerCase()
        || action.arguments[1]?.source !== "input" || action.arguments[1].path !== "amount.spend"
        || action.arguments[2]?.source !== "price_bound" || (action.steps?.length ?? 0) !== 0 || action.orderSizing || action.positionState
        || action.price?.kind !== "min_output" || action.price.amountPath !== "amount.spend"
        || action.price.slippagePath !== "slippage_bps" || action.marketPath !== "market_id"
        || action.fundingPath !== (direction === "buy" ? "amount.spend" : undefined)
        || (/^0x0{40}$/i.test(route.input) ? action.valuePath !== "amount.spend" || action.spendPath !== undefined
          : action.spendPath !== "amount.spend" || action.spendToken?.toLowerCase() !== route.input.toLowerCase() || action.valuePath !== undefined)
        || action.fundingAmount !== undefined || action.spendAmount !== undefined || action.nativeValue !== undefined
        || action.fundingFromBound || action.spendFromBound || action.valueFromBound) issue("integration-spot-action-invalid");
    }
  }
  try {
    assertActionRoutes(v.actions);
    v.actions.forEach((a) => {
      assertStandardDefinition(a, v.use_case);
      if (a.when?.market_id && !markets.includes(a.when.market_id)) throw new Error("integration-market-unregistered");
    });
  } catch (error) { issue(error instanceof Error ? error.message : "integration-definition-invalid"); }
});

export type PluginDefinition = z.infer<typeof pluginDefinitionSchema>;
export type PluginPin = z.infer<typeof pluginPinSchema>;
export type PluginMarket = z.infer<typeof pluginMarketSchema>;

const amount = z.bigint().nonnegative().refine((v) => v < 2n ** 256n);
const id = z.string().min(1).max(128);
export const pluginHoldingSchema = z.strictObject({
  holding_id: id, asset: addressSchema, amount, held_at: address, controlled_by: address,
  withdrawable_now: amount,
}).refine((v) => v.withdrawable_now <= v.amount, "integration-withdrawal-exceeds-holding");
export const pluginOrderSchema = z.strictObject({
  order_id: id, market_id: id, owner: address, direction: z.enum(["buy", "sell", "long", "short"]),
  input_asset: addressSchema, remaining_input: amount, filled_input: amount,
  output_asset: addressSchema, filled_output: amount, exposure: amount,
  status: z.enum(["open", "partially_filled", "cancel_requested"]),
});
const liability = z.strictObject({ liability_id: id, asset: addressSchema, amount });
const position = z.strictObject({
  position_id: id, market_id: id, owner: address,
  assets: z.array(z.strictObject({ asset: addressSchema, amount })).max(16),
  liability: amount, recoverable_value: amount,
});
const request = z.strictObject({ request_id: id, owner: address, market_id: id,
  assets: z.array(z.strictObject({ asset: addressSchema, amount })).max(2), liability: amount,
  recoverable_value: amount, claimable_at: z.number().int().nonnegative(), replaces_position_id: id.optional() });
const state = {
  block: z.strictObject({ number: z.bigint().nonnegative(), hash: bytes32Schema }),
  holdings: z.array(pluginHoldingSchema).max(64), liabilities: z.array(liability).max(32),
};
export const pluginStateSchemas = {
  spot: z.strictObject({ ...state, orders: z.array(pluginOrderSchema).max(32) }),
  perps: z.strictObject({ ...state, positions: z.array(position.extend({
    direction: z.enum(["long", "short"]), margin: amount, notional: amount,
    unrealized_pnl: z.bigint(),
  })).max(32), orders: z.array(pluginOrderSchema).max(32) }),
  vault: z.strictObject({ ...state, positions: z.array(position.extend({ shares: amount })).max(32),
    requests: z.array(request).max(32) }),
  staking: z.strictObject({ ...state, positions: z.array(position.extend({ staked: amount, rewards: amount })).max(32),
    requests: z.array(request).max(32) }),
  liquidity: z.strictObject({ ...state, positions: z.array(position.extend({ liquidity: amount,
    rewards: z.array(z.strictObject({ asset: addressSchema, amount })).max(16) })).max(32) }),
};
export type PluginStates = { [K in keyof typeof pluginStateSchemas]: z.infer<(typeof pluginStateSchemas)[K]> };

export const pluginPlanSchema = z.strictObject({
  calls: z.array(z.strictObject({ target: address, data: z.string().regex(/^0x(?:[a-fA-F0-9]{2}){4,16384}$/),
    value: amount, spend_asset: addressSchema, spend_amount: amount })).min(1).max(8),
  spending: z.array(z.strictObject({ asset: addressSchema, maximum: amount })).max(16),
  receiving: z.array(z.strictObject({ asset: addressSchema, minimum: amount, controlled_by: address })).max(16),
  completion: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("atomic") }),
    z.strictObject({ kind: z.literal("pending"), deadline: z.number().int().positive(),
      tracking: z.strictObject({ target: address, event: z.string().min(1).max(512) }) })]),
});
export type PluginPlan = z.infer<typeof pluginPlanSchema>;
export type PluginExit =
  | { status: "execute"; step_id: string; plan: PluginPlan }
  | { status: "wait"; tracking_id: string; retry_at: number }
  | { status: "blocked"; reason: string }
  | { status: "done" };
