import { canonicalEvidence, pluginDefinitionSchema, pluginPlanSchema, pluginStateSchemas,
  selectCapability, type PluginDefinition, type PluginStates, type PluginPlan, type PluginExit,
  type PluginMarket, type StandardAction, type UseCase } from "@termbook/schema";
import { keccak256, stringToHex, type Address, type Hex, type PublicClient } from "viem";
import { buildExecution } from "../app/execution.js";

export type ReadContext = { client: PublicClient; credit_id: Hex; account: Address;
  block: { number: bigint; hash: Hex }; };
export type ActionContext<A extends StandardAction = StandardAction> = ReadContext & {
  borrower: Address; action: A; price_bound?: bigint; market: PluginMarket; minimum_receive?: bigint; maximum_spend?: bigint;
  position_state?: { market_id: unknown; direction: string };
};
export type ExitContext<U extends UseCase = UseCase> = ReadContext & {
  state: PluginStates[U]; slippage_bps: number; minimum_receive: (market_id: string, asset: Address, amount: bigint) => Promise<bigint>;
};
type ActionFor<U extends UseCase> = Extract<StandardAction, { use_case: U }>;
type Capability<U extends UseCase> = ActionFor<U>["capability"];
export type integration<U extends UseCase> = {
  name: string; use_case: U; chain_id: number; markets: PluginMarket[]; definition: PluginDefinition;
  account: { read(context: ReadContext): Promise<PluginStates[U]> };
  actions: { [C in Capability<U>]?: {
    build(context: ActionContext<Extract<ActionFor<U>, { capability: C }>>): Promise<PluginPlan>;
  } };
  exit: { next(context: ExitContext<U>): Promise<PluginExit> };
};
export type spot = integration<"spot"> & { actions: { place_order: NonNullable<integration<"spot">["actions"]["place_order"]> } };
export type perps = integration<"perps"> & { actions: {
  place_order: NonNullable<integration<"perps">["actions"]["place_order"]>;
  close_position: NonNullable<integration<"perps">["actions"]["close_position"]>;
} };
export type vault = integration<"vault"> & { actions: { deposit_vault: NonNullable<integration<"vault">["actions"]["deposit_vault"]> } };
export type staking = integration<"staking"> & { actions: { stake: NonNullable<integration<"staking">["actions"]["stake"]> } };
export type liquidity = integration<"liquidity"> & { actions: { add_liquidity: NonNullable<integration<"liquidity">["actions"]["add_liquidity"]> } };
export type plugin = spot | perps | vault | staking | liquidity;
export type { PluginDefinition, PluginStates, PluginPlan, PluginExit };

export function package_integration(value: plugin): { definition: PluginDefinition; hash: Hex; version_id: Hex } {
  const definition = pluginDefinitionSchema.parse(structuredClone(value.definition));
  if (!definition.assessment && !definition.atomic_spot) throw new Error("integration-assessment-required");
  if (value.name !== definition.name || value.use_case !== definition.use_case || value.chain_id !== definition.chain_id
    || canonicalEvidence(value.markets) !== canonicalEvidence(definition.markets)
    || typeof value.account?.read !== "function" || typeof value.exit?.next !== "function"
    || definition.actions.some((action) => typeof (value.actions as Record<string, { build?: unknown }>)[action.capability]?.build !== "function")) {
    throw new Error("integration-definition-mismatch");
  }
  const hash = keccak256(stringToHex(canonicalEvidence(definition)));
  const version_id = keccak256(stringToHex(`termbook.integration.v1:${definition.chain_id}:${hash}`));
  return { definition, hash, version_id };
}

export function check_state<U extends UseCase>(use_case: U, state: unknown, context: ReadContext): PluginStates[U] {
  const parsed = pluginStateSchemas[use_case].parse(state) as PluginStates[U];
  if (parsed.block.number !== context.block.number || parsed.block.hash.toLowerCase() !== context.block.hash.toLowerCase()) {
    throw new Error("integration-state-block-mismatch");
  }
  const ids = parsed.holdings.map((holding) => holding.holding_id);
  if (new Set(ids).size !== ids.length || new Set(parsed.holdings.map((h) => `${h.held_at}:${h.asset}`.toLowerCase())).size !== ids.length
    || new Set(parsed.liabilities.map((l) => l.liability_id)).size !== parsed.liabilities.length
    || parsed.holdings.some((holding) => holding.controlled_by.toLowerCase() !== context.account.toLowerCase())) {
    throw new Error("integration-custody-invalid");
  }
  for (const key of ["orders", "positions", "requests"] as const) {
    const entries = (parsed as unknown as Record<string, unknown>)[key];
    if (!Array.isArray(entries)) continue;
    const records = entries as Record<string, unknown>[];
    const names = records.map((record) => String(record[`${key.slice(0, -1)}_id`]));
    if (new Set(names).size !== names.length || records.some((record) => String(record.owner).toLowerCase() !== context.account.toLowerCase())) {
      throw new Error("integration-custody-invalid");
    }
    for (const record of records) if (Array.isArray(record.assets)
      && new Set(record.assets.map((a) => String(a.asset).toLowerCase())).size !== record.assets.length) throw new Error("integration-custody-invalid");
  }
  return parsed;
}

export function check_plan(definition: PluginDefinition, action: StandardAction, plan: unknown,
  context: ActionContext): PluginPlan {
  const parsed = pluginPlanSchema.parse(plan);
  const route = selectCapability(definition.actions, action);
  const execution = buildExecution(route, action, { borrower: context.borrower, account: context.account,
    creditId: context.credit_id, use_case: definition.use_case,
    priceBound: context.price_bound ?? context.minimum_receive ?? context.maximum_spend, state: context.position_state }, definition.settlement_asset as Address);
  const calls = execution.calls.map((call) => ({ target: call.target, data: call.data, value: call.nativeValue,
    spend_asset: call.spendToken, spend_amount: call.spendAmount }));
  if (canonicalEvidence(calls.map(wire)) !== canonicalEvidence(parsed.calls.map(wire))
    || parsed.receiving.some((receipt) => receipt.controlled_by.toLowerCase() !== context.account.toLowerCase())
    || parsed.completion.kind !== (route.settlement === "atomic" ? "atomic" : "pending")) {
    throw new Error("integration-plan-mismatch");
  }
  const budgets = new Map<string, bigint>();
  for (const call of calls) {
    if (call.spend_amount > 0n) budgets.set(call.spend_asset.toLowerCase(), (budgets.get(call.spend_asset.toLowerCase()) ?? 0n) + call.spend_amount);
    if (call.value > 0n) budgets.set(`0x${"0".repeat(40)}`, (budgets.get(`0x${"0".repeat(40)}`) ?? 0n) + call.value);
  }
  if (new Set(parsed.spending.map((s) => s.asset.toLowerCase())).size !== parsed.spending.length
    || parsed.spending.length !== budgets.size || parsed.spending.some((s) => budgets.get(s.asset.toLowerCase()) !== s.maximum)) {
    throw new Error("integration-spend-mismatch");
  }
  if (definition.atomic_spot) {
    const direction = route.when?.direction;
    const market = definition.markets[0]!;
    const output = direction === "buy" ? market.base_asset : definition.settlement_asset;
    if (parsed.receiving.length !== 1 || parsed.receiving[0]!.asset.toLowerCase() !== output.toLowerCase()
      || parsed.receiving[0]!.minimum !== context.minimum_receive || context.minimum_receive === undefined
      || context.minimum_receive <= 0n) throw new Error("integration-receipt-mismatch");
  }
  return parsed;
}

function wire(value: unknown): unknown {
  if (typeof value === "bigint") return String(value);
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return value.toLowerCase();
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)]));
  return value;
}
