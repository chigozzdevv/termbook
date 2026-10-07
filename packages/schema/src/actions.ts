import { z } from "zod";

export const useCaseSchema = z.enum(["perps", "staking", "vault", "liquidity", "spot"]);
export type UseCase = z.infer<typeof useCaseSchema>;
const uint = z.union([z.bigint(), z.string().regex(/^\d{1,78}$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
  .refine((value) => /^\d{1,78}$/.test(String(value)) && BigInt(value) < 2n ** 256n, "action-amount-invalid");
const positive = uint.refine((value) => /^\d{1,78}$/.test(String(value)) && BigInt(value) > 0n, "action-amount-invalid");
const id = z.union([z.string().min(1).max(128), uint]);
const bps = uint.refine((value) => /^\d{1,78}$/.test(String(value)) && BigInt(value) <= 5000n, "action-slippage-invalid");
const expiry = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sizing = z.union([z.strictObject({ spend: positive }), z.strictObject({ receive: positive })]);
const spotOrder = {
  market_id: id, direction: z.enum(["buy", "sell"]), amount: sizing,
};
const marketSpot = z.strictObject({ ...spotOrder, order_type: z.literal("market"), slippage_bps: bps });
const limitSpot = z.strictObject({ ...spotOrder, order_type: z.literal("limit"), limit_price: positive, expires_at: expiry });
const position = { position_id: id };
const perpsOrder = { market_id: id, direction: z.enum(["long", "short"]), amount: z.strictObject({ margin: positive, notional: positive }) };
const perpsParams = z.union([
  z.strictObject({ ...perpsOrder, order_type: z.literal("market"), slippage_bps: bps }),
  z.strictObject({ ...perpsOrder, order_type: z.literal("limit"), limit_price: positive, expires_at: expiry }),
]);
const assetAmounts = <T extends z.ZodType<{ asset_id: z.infer<typeof id> }>>(schema: T) => z.array(schema)
  .min(1).max(16).refine((values) => new Set(values.map((value) => String(value.asset_id).toLowerCase())).size === values.length,
    "action-asset-duplicate");

export const actionParameters = {
  spot: {
    place_order: z.union([marketSpot, limitSpot]),
    modify_order: z.strictObject({ ...spotOrder, order_id: id, limit_price: positive, expires_at: expiry }),
    cancel_order: z.strictObject({ order_id: id }),
  },
  perps: {
    place_order: perpsParams,
    increase_position: z.strictObject({ ...position, amount: z.strictObject({ margin: positive, notional: positive }), slippage_bps: bps }),
    decrease_position: z.strictObject({ ...position, amount: z.strictObject({ notional: positive }), slippage_bps: bps }),
    add_margin: z.strictObject({ ...position, amount: positive }),
    remove_margin: z.strictObject({ ...position, amount: positive }),
    cancel_order: z.strictObject({ order_id: id }),
    close_position: z.strictObject({ ...position, slippage_bps: bps }),
  },
  vault: {
    deposit_vault: z.strictObject({ market_id: id, amount_in: positive, min_shares: positive }),
    redeem_vault: z.strictObject({ ...position, shares_in: positive, min_amount_out: positive }),
    claim_rewards: z.strictObject(position),
    withdraw_to_credit_account: z.strictObject({ request_id: id }),
  },
  staking: {
    stake: z.strictObject({ market_id: id, amount_in: positive, min_receipt_out: positive.optional() }),
    claim_rewards: z.strictObject(position),
    request_unstake: z.strictObject({ ...position, amount: positive }),
    complete_unstake: z.strictObject({ request_id: id }),
    withdraw_to_credit_account: z.strictObject({ ...position, amount: positive }),
  },
  liquidity: {
    add_liquidity: z.strictObject({ market_id: id, amounts_in: assetAmounts(z.strictObject({ asset_id: id, amount_in: positive })), min_liquidity_out: positive,
      tick_lower: z.number().int().min(-887272).max(887272).optional(), tick_upper: z.number().int().min(-887272).max(887272).optional() })
      .refine((value) => value.tick_lower === undefined && value.tick_upper === undefined
        || value.tick_lower !== undefined && value.tick_upper !== undefined && value.tick_lower < value.tick_upper, "action-ticks-invalid"),
    remove_liquidity: z.strictObject({ ...position, liquidity_in: positive, min_amounts_out: assetAmounts(z.strictObject({ asset_id: id, min_amount_out: positive })) }),
    stake_lp: z.strictObject({ ...position, amount: positive.optional() }),
    unstake_lp: z.strictObject({ ...position, amount: positive.optional() }),
    claim_rewards: z.strictObject(position),
    collect_fees: z.strictObject(position),
  },
} as const;

function entry<U extends UseCase, C extends string, P extends z.ZodType>(use_case: U, capability: C, params: P) {
  return z.strictObject({ use_case: z.literal(use_case), capability: z.literal(capability), params });
}
export const standardActionSchema = z.union([
  entry("spot", "place_order", actionParameters.spot.place_order),
  entry("spot", "modify_order", actionParameters.spot.modify_order),
  entry("spot", "cancel_order", actionParameters.spot.cancel_order),
  entry("perps", "place_order", actionParameters.perps.place_order),
  entry("perps", "increase_position", actionParameters.perps.increase_position),
  entry("perps", "decrease_position", actionParameters.perps.decrease_position),
  entry("perps", "add_margin", actionParameters.perps.add_margin),
  entry("perps", "remove_margin", actionParameters.perps.remove_margin),
  entry("perps", "cancel_order", actionParameters.perps.cancel_order),
  entry("perps", "close_position", actionParameters.perps.close_position),
  entry("vault", "deposit_vault", actionParameters.vault.deposit_vault),
  entry("vault", "redeem_vault", actionParameters.vault.redeem_vault),
  entry("vault", "claim_rewards", actionParameters.vault.claim_rewards),
  entry("vault", "withdraw_to_credit_account", actionParameters.vault.withdraw_to_credit_account),
  entry("staking", "stake", actionParameters.staking.stake),
  entry("staking", "claim_rewards", actionParameters.staking.claim_rewards),
  entry("staking", "request_unstake", actionParameters.staking.request_unstake),
  entry("staking", "complete_unstake", actionParameters.staking.complete_unstake),
  entry("staking", "withdraw_to_credit_account", actionParameters.staking.withdraw_to_credit_account),
  entry("liquidity", "add_liquidity", actionParameters.liquidity.add_liquidity),
  entry("liquidity", "remove_liquidity", actionParameters.liquidity.remove_liquidity),
  entry("liquidity", "stake_lp", actionParameters.liquidity.stake_lp),
  entry("liquidity", "unstake_lp", actionParameters.liquidity.unstake_lp),
  entry("liquidity", "claim_rewards", actionParameters.liquidity.claim_rewards),
  entry("liquidity", "collect_fees", actionParameters.liquidity.collect_fees),
]);
export type StandardAction = z.infer<typeof standardActionSchema>;
export type SpotAction = Extract<StandardAction, { use_case: "spot" }>;
export type PerpsAction = Extract<StandardAction, { use_case: "perps" }>;
export type VaultAction = Extract<StandardAction, { use_case: "vault" }>;
export type StakingAction = Extract<StandardAction, { use_case: "staking" }>;
export type LiquidityAction = Extract<StandardAction, { use_case: "liquidity" }>;

export type ActionField = { path: string; choices?: string[]; type: "integer" | "id" | "json" | "choice"; optional?: boolean };
export function standardActionFields(use_case: UseCase, capability: string, params: Record<string, unknown> = {}): ActionField[] {
  const catalogue: Record<string, Record<string, string[]>> = {
    spot: { place_order: ["market_id", "direction", "order_type", "amount", "protection"],
      modify_order: ["order_id", "market_id", "direction", "amount", "limit_price", "expires_at"], cancel_order: ["order_id"] },
    perps: { place_order: ["market_id", "direction", "order_type", "amount.margin", "amount.notional", "protection"],
      increase_position: ["position_id", "amount.margin", "amount.notional", "slippage_bps"],
      decrease_position: ["position_id", "amount.notional", "slippage_bps"], add_margin: ["position_id", "amount"],
      remove_margin: ["position_id", "amount"], cancel_order: ["order_id"], close_position: ["position_id", "slippage_bps"] },
    vault: { deposit_vault: ["market_id", "amount_in", "min_shares"], redeem_vault: ["position_id", "shares_in", "min_amount_out"],
      claim_rewards: ["position_id"], withdraw_to_credit_account: ["request_id"] },
    staking: { stake: ["market_id", "amount_in", "min_receipt_out?"], claim_rewards: ["position_id"],
      request_unstake: ["position_id", "amount"], complete_unstake: ["request_id"], withdraw_to_credit_account: ["position_id", "amount"] },
    liquidity: { add_liquidity: ["market_id", "amounts_in", "min_liquidity_out", "tick_lower?", "tick_upper?"],
      remove_liquidity: ["position_id", "liquidity_in", "min_amounts_out"], stake_lp: ["position_id", "amount?"],
      unstake_lp: ["position_id", "amount?"], claim_rewards: ["position_id"], collect_fees: ["position_id"] },
  };
  const paths = catalogue[use_case]?.[capability];
  if (!paths) throw new Error("capability-denied");
  return paths.flatMap((field): ActionField[] => {
    if (field === "protection") return params.order_type === "limit"
      ? [{ path: "limit_price", type: "integer" }, { path: "expires_at", type: "integer" }]
      : [{ path: "slippage_bps", type: "integer" }];
    if (field === "amount" && use_case === "spot") return [{ path: "amount", type: "json" }];
    const path = field.replace(/\?$/, "");
    const choices = path === "direction" ? use_case === "spot" ? ["buy", "sell"] : ["long", "short"]
      : path === "order_type" ? ["market", "limit"] : undefined;
    return [{ path, type: choices ? "choice" : path.endsWith("_id") ? "id"
      : ["amounts_in", "min_amounts_out"].includes(path) ? "json" : "integer", ...(choices ? { choices } : {}), optional: field.endsWith("?") }];
  });
}

export function assertStandardAction(action: { use_case?: UseCase; capability: string; params: Record<string, unknown> },
  expected?: UseCase, now = Math.floor(Date.now() / 1000)): void {
  const use_case = action.use_case ?? expected;
  if (!use_case) return;
  if (expected && use_case !== expected) throw new Error("action-use-case-mismatch");
  const parsed = standardActionSchema.safeParse({ ...action, use_case });
  if (!parsed.success) throw new Error("action-params-invalid");
  const expires = parsed.data.params as Record<string, unknown>;
  if (expires.expires_at !== undefined && (Number(expires.expires_at) <= now || Number(expires.expires_at) > now + 30 * 86400)) {
    throw new Error("action-expiry-invalid");
  }
}
