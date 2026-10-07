import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, keccak256, parseAbi, padHex, stringToHex } from "viem";
import type { CapabilityDefinition } from "@termbook/schema";
import type { TermbookClient } from "../src/client/client.js";
import { buildExecution } from "../src/app/execution.js";
import { deriveExecutionBound, deriveExecutionAmountBound, executionPrice } from "../src/app/price.js";

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
  const read = vi.fn(async (_address: unknown, _abi: unknown, method: string): Promise<unknown> => {
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
  it("converts USDC and native token amounts with the approved quote direction", () => {
    expect(deriveExecutionAmountBound(2000n * 10n ** 18n, 100n * 10n ** 6n, 50, 6, 18, true, false)).toBe(49_750_000_000_000_000n);
    expect(deriveExecutionAmountBound(2000n * 10n ** 18n, 10n ** 18n, 50, 18, 6, false, false)).toBe(1990_000_000n);
    expect(deriveExecutionAmountBound(2000n * 10n ** 18n, 10n ** 18n, 50, 6, 18, true, true)).toBe(2010_000_000n);
    expect(deriveExecutionAmountBound(10n ** 18n, 2n ** 256n - 1n, 0, 18, 18, false, false)).toBe(2n ** 256n - 1n);
  });
  it("rejects an amount change after a spot bound has been reviewed", async () => {
    const { client, read } = fixture();
    read.mockImplementation(async (_address, _abi, method) => {
      if (method === "priceProtection") return address;
      if (method === "rule") return { oracle: address, feedId: credit, priceDecimals: 8, maxSlippageBps: 100, maxAuthorizationAge: 60 };
      if (method === "houseSlippage") return 75;
      if (method === "amountRules") return [0, 6, 18, true, false, true, address, `0x${"2".repeat(40)}`];
      if (method === "read") return [2000n * 10n ** 18n, 900n, 3n];
      throw new Error(method);
    });
    const swap: CapabilityDefinition = { capability: "swap", label: "Swap", target: address, signature: "function swap(uint256 amount,uint256 minimum,uint256 market)",
      arguments: [{ source: "input", path: "amount" }, { source: "price_bound" }, { source: "input", path: "market" }], fundingPath: "amount", marketPath: "market", settlement: "atomic",
      price: { kind: "min_output", amountPath: "amount", slippagePath: "slippage_bps", markets: [market] } };
    const input = { capability: "swap", params: { amount: "100000000", market: "2", slippage_bps: 50 } };
    const quote = (await executionPrice(client, credit, credit, swap, input))!;
    expect(quote.bound).toBe(49_750_000_000_000_000n);
    const plan = buildExecution(swap, input, { borrower: address, account: address, creditId: credit, priceBound: quote.bound }, address);
    expect(decodeFunctionData({ abi: parseAbi([swap.signature]), data: plan.calls[0]!.data }).args?.[1]).toBe(quote.bound);
    await expect(executionPrice(client, credit, credit, swap, { ...input, params: { ...input.params, amount: "200000000" } }, quote)).rejects.toThrow("action-review-stale");
  });
  it("rounds maximum down and minimum up after unit conversion", () => {
    expect(deriveExecutionBound(10n ** 18n + 1n, 0, true, 8)).toBe(100_000_000n);
    expect(deriveExecutionBound(10n ** 18n + 1n, 0, false, 8)).toBe(100_000_001n);
    expect(() => deriveExecutionBound(1n, 50, true, 8)).toThrow("action-price-invalid");
  });
});
