import { describe, expect, it, vi } from "vitest";
import { actionFunding, actionInputs, assertActionRoutes, assertStandardDefinition, executionKey, selectCapability, type CapabilityDefinition, type TermAction } from "@termbook/schema";
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbiItem, stringToHex } from "viem";
import { buildExecution } from "../src/app/execution.js";
import { executionPrice } from "../src/app/price.js";
import { readActionState } from "../src/app/state.js";
import type { TermbookClient } from "../src/client/client.js";

const address = (s: string) => `0x${s.repeat(40)}` as `0x${string}`;
const id = keccak256(stringToHex("credit")), market = keccak256(stringToHex("TOKEN-USDC"));
const context = { borrower: address("1"), account: address("2"), creditId: id, use_case: "spot" as const };
const marketRoute = (direction: "buy" | "sell", sizing: "spend" | "receive"): CapabilityDefinition => ({
  capability: "place_order", executionKey: `order_${direction}_${sizing}`, label: "Place order", target: address("3"), settlement: "atomic",
  signature: "function trade(uint256 size,uint256 bound,bytes32 market,address recipient)",
  arguments: [{ source: "input", path: `amount.${sizing}` }, { source: "price_bound" }, { source: "input", path: "market_id", choices: { "TOKEN-USDC": market } }, { source: "credit_account" }],
  when: { direction, order_type: "market", sizing }, marketPath: "market_id", spendToken: direction === "buy" ? address("4") : address("5"),
  ...sizing === "spend" ? { spendPath: "amount.spend", ...direction === "buy" ? { fundingPath: "amount.spend" } : {} }
    : { spendFromBound: direction === "sell", fundingFromBound: direction === "buy" },
  price: { kind: sizing === "spend" ? "min_output" : "max_input", amountPath: `amount.${sizing}`, slippagePath: "slippage_bps", markets: [market] },
});
const limitRoute = (direction: "buy" | "sell", sizing: "spend" | "receive"): CapabilityDefinition => ({
  capability: "place_order", executionKey: `limit_${direction}_${sizing}`, label: "Place limit order", target: address("3"), settlement: "asynchronous",
  signature: "function limit(uint256 quantity,uint8 side,uint256 price,uint256 expiry,bytes32 market,address recipient)",
  arguments: [{ source: "input", path: "_derived.order_quantity" }, { source: "input", path: "direction", choices: { buy: "1", sell: "2" } },
    { source: "price_bound" }, { source: "input", path: "expires_at" }, { source: "input", path: "market_id", choices: { "TOKEN-USDC": market } }, { source: "credit_account" }],
  when: { direction, order_type: "limit", sizing }, marketPath: "market_id", spendToken: direction === "buy" ? address("4") : address("5"),
  spendPath: "_derived.order_spend", ...direction === "buy" ? { fundingPath: "_derived.order_spend" } : {},
  orderSizing: { baseAsset: address("5"), quoteAsset: address("4"), baseDecimals: 18, quoteDecimals: 6, feeBps: 100, lotSize: "1000000000000000" },
  price: { kind: "price", directionPath: "direction", maximumDirections: ["buy"], minimumDirections: ["sell"], markets: [market] },
});
function order(direction: "buy" | "sell", sizing: "spend" | "receive", order_type: "market" | "limit", amount: bigint): TermAction {
  return { use_case: "spot", capability: "place_order", params: { market_id: "TOKEN-USDC", direction, order_type, amount: { [sizing]: amount },
    ...order_type === "market" ? { slippage_bps: 50 } : { limit_price: 2_500_000_000_000_000_000n, expires_at: Math.floor(Date.now() / 1000) + 3600 } } };
}
describe("standard execution routes", () => {
  it("selects one pinned route while preserving the public capability", () => {
    const routes = [marketRoute("buy", "spend"), marketRoute("buy", "receive"), marketRoute("sell", "spend"), limitRoute("buy", "spend")];
    expect(() => assertActionRoutes(routes)).not.toThrow();
    routes.forEach((route) => expect(() => assertStandardDefinition(route, "spot")).not.toThrow());
    const action = order("sell", "spend", "market", 10n ** 18n);
    const route = selectCapability(routes, action);
    const plan = buildExecution(route, action, { ...context, priceBound: 2_487_500n }, address("4"));
    expect(plan.requiredInput).toBe(0n);
    expect(plan.capability).toBe(keccak256(stringToHex(executionKey(route))));
    expect(plan.calls[0]).toMatchObject({ spendToken: address("5"), spendAmount: 10n ** 18n });
    expect(() => assertActionRoutes([...routes, { ...routes[0]!, executionKey: "duplicate" }])).toThrow("action-route-ambiguous");
    expect(() => selectCapability(routes, order("sell", "receive", "market", 100n))).toThrow("capability-denied");
  });
  it("funds a receive target from the reviewed bound and uses account recipients", () => {
    const route = marketRoute("buy", "receive"), action = order("buy", "receive", "market", 10n * 10n ** 18n);
    const plan = buildExecution(route, action, { ...context, priceBound: 25_125_000n }, address("4"));
    expect(plan.requiredInput).toBe(25_125_000n); expect(actionFunding(route, action, 25_125_000n)).toBe(25_125_000n);
    const data = decodeFunctionData({ abi: [parseAbiItem(route.signature)], data: plan.calls[0]!.data });
    expect(data.args).toEqual([10n * 10n ** 18n, 25_125_000n, market, context.account]);
  });
  it("keeps limit buy budgets within the requested amount after fees and lot rounding", () => {
    const route = limitRoute("buy", "spend"), action = order("buy", "spend", "limit", 100_000_000n);
    const derived = actionInputs(route, action)._derived as { order_quantity: bigint; order_spend: bigint };
    expect(derived.order_quantity % BigInt(route.orderSizing!.lotSize)).toBe(0n);
    expect(derived.order_spend).toBeLessThanOrEqual(100_000_000n);
    expect(derived.order_spend).toBe(99_997_575n);
    const plan = buildExecution(route, action, { ...context, priceBound: 2_500_000_000_000_000_000n }, address("4"));
    expect(plan.requiredInput).toBe(derived.order_spend);
    expect(decodeFunctionData({ abi: [parseAbiItem(route.signature)], data: plan.calls[0]!.data }).args)
      .toEqual([derived.order_quantity, 1, 2_500_000_000_000_000_000n, BigInt(String(action.params.expires_at)), market, context.account]);
    expect(() => actionInputs(route, order("buy", "spend", "limit", 1n))).toThrow("action-sizing-invalid");
  });
  it("sizes buy quantities and sell proceeds targets independently of the order mechanism", () => {
    expect(actionFunding(limitRoute("buy", "receive"), order("buy", "receive", "limit", 10n * 10n ** 18n))).toBe(25_250_000n);
    const route = limitRoute("sell", "receive"), action = order("sell", "receive", "limit", 25_000_000n);
    const derived = actionInputs(route, action)._derived as { order_quantity: bigint; order_spend: bigint };
    expect(derived.order_quantity * 2_500_000_000_000_000_000n * 10n ** 6n * 9900n / (10n ** 36n * 10000n)).toBeGreaterThanOrEqual(25_000_000n);
    expect(buildExecution(route, action, { ...context, priceBound: 2_500_000_000_000_000_000n }, address("4")).requiredInput).toBe(0n);
  });
  it("keeps fixed execution fees out of borrower parameters", () => {
    const route = { ...marketRoute("buy", "spend"), steps: [{ target: address("6"), signature: "function fee(uint256 fee,address recipient)",
      arguments: [{ source: "constant" as const, value: "5" }, { source: "credit_account" as const }], fundingAmount: "5" }] };
    const action = order("buy", "spend", "market", 100n);
    expect(buildExecution(route, action, { ...context, priceBound: 1n }, address("4")).requiredInput).toBe(105n);
    expect(() => actionFunding(route, { ...action, params: { ...action.params, execution_fee: 1n } }, 1n)).toThrow("action-params-invalid");
  });
  it("maps indexed liquidity inputs without making the recipient caller-controlled", () => {
    const route: CapabilityDefinition = { capability: "add_liquidity", label: "Add liquidity", target: address("3"), settlement: "atomic",
      signature: "function add(address token,uint256 amount,uint256 minimum,bytes32 market,address recipient)",
      arguments: [{ source: "input", path: "amounts_in.0.asset_id", choices: { USDC: address("4") } },
        { source: "input", path: "amounts_in.0.amount_in" }, { source: "input", path: "min_liquidity_out" },
        { source: "input", path: "market_id", choices: { pool: market } }, { source: "credit_account" }],
      fundingPath: "amounts_in.0.amount_in", marketPath: "market_id" };
    assertStandardDefinition(route, "liquidity");
    const action: TermAction = { use_case: "liquidity", capability: "add_liquidity", params: { market_id: "pool", amounts_in: [{ asset_id: "USDC", amount_in: 100n }], min_liquidity_out: 95n } };
    expect(buildExecution(route, action, { ...context, use_case: "liquidity" }, address("4")).requiredInput).toBe(100n);
    expect(() => actionFunding(route, { ...action, params: { ...action.params, amounts_in: [{ asset_id: "USDC", amount_in: 100n }, { asset_id: "MON", amount_in: 10n }] } })).toThrow("action-input-invalid");
  });
});
describe("limit review and registered position state", () => {
  it("preserves a stricter limit, rejects a looser one and checks the route price key", async () => {
    const read = vi.fn(async (_address: string, _abi: unknown, method: string) => method === "priceProtection" ? address("a") : method === "rule"
      ? { oracle: address("b"), feedId: market, priceDecimals: 18, maxSlippageBps: 100 } : method === "houseSlippage" ? 50 : method === "referenceVersion" ? 1n
        : [3n * 10n ** 18n, 1000n, 1n]);
    const client = { config: { core: address("c") }, rpc: { read, client: { getBlock: async () => ({ timestamp: 1000n }) } } } as unknown as TermbookClient;
    const route = limitRoute("buy", "spend"), action = order("buy", "spend", "limit", 100_000_000n);
    const quote = await executionPrice(client, id, market, route, action);
    expect(quote?.bound).toBe(2_500_000_000_000_000_000n);
    expect(read).toHaveBeenCalledWith(address("a"), expect.anything(), "rule", [market, keccak256(stringToHex(route.executionKey!)), market]);
    await expect(executionPrice(client, id, market, route, { ...action, params: { ...action.params, limit_price: 4n * 10n ** 18n } })).rejects.toThrow("action-limit-price-denied");
    await expect(executionPrice(client, id, market, route, { ...action, params: { ...action.params, limit_price: 2n * 10n ** 18n } }, quote)).rejects.toThrow("action-review-stale");
  });
  it("gets market and direction from the account-bound position getter", async () => {
    const state: NonNullable<CapabilityDefinition["positionState"]> = { target: address("3"), signature: "function position(address account,uint256 id) view returns (bytes32 market,uint8 direction)",
      arguments: [{ source: "credit_account" }, { source: "input", path: "position_id" }], marketIndex: 0, directionIndex: 1, directions: { long: "1", short: "2" } };
    const call = vi.fn(async (_request: { data: `0x${string}` }) => ({ data: encodeFunctionResult({ abi: [parseAbiItem(state.signature)], functionName: "position", result: [market, 2] as never }) }));
    const client = { rpc: { client: { call } } } as unknown as TermbookClient;
    const result = await readActionState(client, { ...marketRoute("buy", "spend"), positionState: state },
      { use_case: "perps", capability: "close_position", params: { position_id: "7", slippage_bps: 50 } }, context);
    expect(result).toEqual({ market_id: market, direction: "short" });
    expect(decodeFunctionData({ abi: [parseAbiItem(state.signature)], data: call.mock.calls[0]![0].data }).args).toEqual([context.account, 7n]);
  });
});
