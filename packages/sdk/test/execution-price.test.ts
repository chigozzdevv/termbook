import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, keccak256, parseAbi, padHex, stringToHex } from "viem";
import type { CapabilityDefinition } from "@termbook/schema";
import type { TermbookClient } from "../src/client/client.js";
import { buildExecution } from "../src/app/execution.js";
import { deriveExecutionBound, executionPrice } from "../src/app/price.js";

const address = `0x${"1".repeat(40)}` as const;
const credit = padHex("0x01", { size: 32 });
const market = padHex("0x02", { size: 32 });
const definition: CapabilityDefinition = { capability: "place_order", label: "Trade", target: address,
  signature: "function trade(uint256 margin,uint256 direction,uint256 price,uint256 market)",
  arguments: [{ source: "input", path: "margin" }, { source: "input", path: "direction", choices: { long: "1", short: "2" } },
    { source: "price_bound" }, { source: "input", path: "market" }], fundingPath: "margin", marketPath: "market",
  settlement: "atomic", price: { slippagePath: "slippage_bps", directionPath: "direction",
    maximumDirections: ["long"], minimumDirections: ["short"], markets: [market] } };
const action = { capability: "place_order", params: { margin: "100", market: "2", direction: "long", slippage_bps: 50 } };
function fixture() {
  const read = vi.fn(async (_address, _abi, method) => {
    if (method === "priceProtection") return address;
    if (method === "rule") return { oracle: address, feedId: keccak256(stringToHex("ETH")), priceDecimals: 8,
      maxSlippageBps: 100, maxAuthorizationAge: 60 };
    if (method === "houseSlippage") return 75;
    if (method === "read") return [2000n * 10n ** 18n, 900n, 3n];
    throw new Error(method);
  });
  const client = { config: { core: address }, rpc: { read, client: { getBlock: async () => ({ timestamp: 1000n }) } } } as unknown as TermbookClient;
  return { read, client };
}
describe("derived execution prices", () => {
  it("derives the actual calldata bound and preserves the reviewed reference", async () => {
    const { client, read } = fixture();
    const quote = (await executionPrice(client, credit, credit, definition, action))!;
    expect(quote).toMatchObject({ referencePrice: 2000n * 10n ** 18n, bound: 2010n * 10n ** 8n, roundId: 3n });
    const plan = buildExecution(definition, action, { borrower: address, account: address, creditId: credit, priceBound: quote.bound }, address);
    expect(decodeFunctionData({ abi: parseAbi([definition.signature]), data: plan.calls[0]!.data }).args?.[2]).toBe(quote.bound);
    read.mockClear();
    expect(await executionPrice(client, credit, credit, definition, action, quote)).toEqual(quote);
    expect(read.mock.calls.some((call) => call[2] === "read")).toBe(false);
  });
  it("rejects a caller-supplied bound and House cap violations", async () => {
    const { client } = fixture();
    await expect(executionPrice(client, credit, credit, definition, { ...action, params: { ...action.params, slippage_bps: 76 } })).rejects.toThrow("action-slippage-denied");
    const quote = (await executionPrice(client, credit, credit, definition, action))!;
    expect(() => buildExecution(definition, { ...action, params: { ...action.params, price_bound: "123" } },
      { borrower: address, account: address, creditId: credit, priceBound: quote.bound }, address)).toThrow("action-input-invalid");
    await expect(executionPrice(client, credit, credit, definition, { ...action, params: { ...action.params, direction: "short" } }, quote)).rejects.toThrow("action-review-stale");
  });
  it("rounds maximum down and minimum up after unit conversion", () => {
    expect(deriveExecutionBound(10n ** 18n + 1n, 0, true, 8)).toBe(100_000_000n);
    expect(deriveExecutionBound(10n ** 18n + 1n, 0, false, 8)).toBe(100_000_001n);
    expect(() => deriveExecutionBound(1n, 50, true, 8)).toThrow("action-price-invalid");
  });
});
