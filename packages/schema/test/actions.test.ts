import { describe, expect, it } from "vitest";
import { assertStandardAction, standardActionSchema, type TermAction } from "../src/index.js";

const order = { market_id: "TOKEN-USDC", direction: "buy", order_type: "market", amount: { spend: "100000000" }, slippage_bps: 50 };
const examples: TermAction[] = [
  { use_case: "spot", capability: "place_order", params: order },
  { use_case: "spot", capability: "modify_order", params: { order_id: "1", market_id: "TOKEN-USDC", direction: "sell", amount: { spend: 10n ** 18n }, limit_price: 2n * 10n ** 18n, expires_at: 2000 } },
  { use_case: "spot", capability: "cancel_order", params: { order_id: "1" } },
  { use_case: "perps", capability: "place_order", params: { market_id: "ETH", direction: "long", order_type: "market", amount: { margin: 100n, notional: 200n }, slippage_bps: 50 } },
  { use_case: "perps", capability: "increase_position", params: { position_id: "1", amount: { margin: 100n, notional: 200n }, slippage_bps: 50 } },
  { use_case: "perps", capability: "decrease_position", params: { position_id: "1", amount: { notional: 100n }, slippage_bps: 50 } },
  ...["add_margin", "remove_margin"].map((capability) => ({ use_case: "perps" as const, capability, params: { position_id: "1", amount: 100n } })),
  { use_case: "perps", capability: "cancel_order", params: { order_id: "1" } },
  { use_case: "perps", capability: "close_position", params: { position_id: "1", slippage_bps: 50 } },
  { use_case: "vault", capability: "deposit_vault", params: { market_id: "vault", amount_in: 100n, min_shares: 95n } },
  { use_case: "vault", capability: "redeem_vault", params: { position_id: "1", shares_in: 100n, min_amount_out: 90n } },
  { use_case: "vault", capability: "claim_rewards", params: { position_id: "1" } },
  { use_case: "vault", capability: "withdraw_to_credit_account", params: { request_id: "1" } },
  { use_case: "staking", capability: "stake", params: { market_id: "staking", amount_in: 100n, min_receipt_out: 90n } },
  { use_case: "staking", capability: "claim_rewards", params: { position_id: "1" } },
  { use_case: "staking", capability: "request_unstake", params: { position_id: "1", amount: 100n } },
  { use_case: "staking", capability: "complete_unstake", params: { request_id: "1" } },
  { use_case: "staking", capability: "withdraw_to_credit_account", params: { position_id: "1", amount: 100n } },
  { use_case: "liquidity", capability: "add_liquidity", params: { market_id: "pool", amounts_in: [{ asset_id: "USDC", amount_in: 100n }], min_liquidity_out: 90n } },
  { use_case: "liquidity", capability: "remove_liquidity", params: { position_id: "1", liquidity_in: 100n, min_amounts_out: [{ asset_id: "USDC", min_amount_out: 90n }] } },
  ...["stake_lp", "unstake_lp", "claim_rewards", "collect_fees"].map((capability) => ({ use_case: "liquidity" as const, capability, params: { position_id: "1" } })),
];
describe("standard action catalogue", () => {
  it.each(examples)("accepts $use_case $capability with its standard inputs", (action) => {
    expect(standardActionSchema.safeParse(action).success).toBe(true);
    expect(() => assertStandardAction(action, action.use_case, 1000)).not.toThrow();
  });
  it.each(["buy", "sell"])("keeps sizing independent of order type for %s", (direction) => {
    for (const mode of ["spend", "receive"]) for (const order_type of ["market", "limit"]) {
      const params = { market_id: "TOKEN-USDC", direction, order_type, amount: { [mode]: 100n },
        ...order_type === "market" ? { slippage_bps: 50 } : { limit_price: 2n * 10n ** 18n, expires_at: 2000 } };
      expect(() => assertStandardAction({ use_case: "spot", capability: "place_order", params }, "spot", 1000)).not.toThrow();
    }
  });
  it.each([{}, { spend: 100n, receive: 50n }, { spend: 0n }, { spend: -1n }, { spend: "abc" },
    { spend: 1.5 }, { spend: Number.MAX_SAFE_INTEGER + 1 }, { spend: 2n ** 256n }])("rejects invalid sizing %s", (amount) => {
    expect(() => assertStandardAction({ use_case: "spot", capability: "place_order", params: { ...order, amount } })).toThrow("action-params-invalid");
  });
  it("rejects undeclared names, fields, wrong directions and protection modes", () => {
    for (const capability of ["swap_exact_in", "swap_exact_out", "sell_to_settlement", "spot_place_order"]) {
      expect(() => assertStandardAction({ use_case: "spot", capability, params: order })).toThrow("action-params-invalid");
    }
    for (const extra of [{ target: "0x1234" }, { amount_in: "100" }, { _derived: { order_spend: 1n } }, { limit_price: 1n },
      { direction: "long" }, { slippage_bps: 5001 }]) expect(() => assertStandardAction({ use_case: "spot", capability: "place_order", params: { ...order, ...extra } })).toThrow();
    expect(() => assertStandardAction({ capability: "place_order", params: order }, "perps")).toThrow("action-params-invalid");
  });
  it("checks deadlines, unique assets and complete tick ranges", () => {
    const limit = { ...order, order_type: "limit", slippage_bps: undefined, limit_price: 1n, expires_at: 999 };
    delete limit.slippage_bps;
    expect(() => assertStandardAction({ use_case: "spot", capability: "place_order", params: limit }, "spot", 1000)).toThrow("action-expiry-invalid");
    const add = examples.find((action) => action.capability === "add_liquidity")!;
    for (const extra of [{ amounts_in: [{ asset_id: "USDC", amount_in: 1n }, { asset_id: "usdc", amount_in: 1n }] },
      { tick_lower: 100 }, { tick_lower: 100, tick_upper: 50 }, { min_liquidity_out: 0n }]) {
      expect(() => assertStandardAction({ ...add, params: { ...add.params, ...extra } })).toThrow("action-params-invalid");
    }
  });
});
