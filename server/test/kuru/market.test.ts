import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { decodeBook, decimalRatio } from "../../src/kuru/market.js";
const packed = (...words: bigint[]) => `0x${words.map((word) => word.toString(16).padStart(64, "0")).join("")}` as Hex;

describe("Kuru market data", () => {
  it("decodes bids and asks in their published precision", () => {
    expect(decodeBook(packed(10n, 2510300n, 10_000_000_000n, 0n, 2535600n, 5_000_000_000n), 10n, 100_000_000n, 10_000_000_000n))
      .toEqual({ bids: [{ price: "0.025103", size: "1" }], asks: [{ price: "0.025356", size: "0.5" }] });
  });
  it("accepts an empty order book without inventing liquidity", () => {
    expect(decodeBook(packed(10n, 0n), 10n, 100n, 100n)).toEqual({ bids: [], asks: [] });
  });
  it("accepts a one-sided book", () => {
    expect(decodeBook(packed(10n, 2n, 1n, 0n), 10n, 100n, 100n)).toEqual({ bids: [{ price: "0.02", size: "0.01" }], asks: [] });
    expect(decodeBook(packed(10n, 0n, 2n, 1n), 10n, 100n, 100n)).toEqual({ bids: [], asks: [{ price: "0.02", size: "0.01" }] });
  });
  it.each([
    [10n, 2n, 1n, 0n, 1n, 1n, 0n],
    [10n, 1n, 1n, 2n, 1n, 0n, 0n],
    [10n, 2n, 0n, 0n, 0n],
    [11n, 0n, 0n],
    [10n, 2n, 1n, 0n, 0n, 1n],
    [10n, 2n, 1n],
  ])("rejects crossed, unordered, truncated or mismatched books: %#", (...words) => {
    expect(() => decodeBook(packed(...words), 10n, 100n, 100n)).toThrow("kuru-book-invalid");
  });
  it("rejects zero precision", () => { expect(() => decodeBook(packed(10n, 0n, 0n), 10n, 0n, 100n)).toThrow(); });
  it("formats ratios without floating point loss", () => { expect(decimalRatio(1n, 10n ** 18n)).toBe("0.000000000000000001"); });
  it("converts the trade event's fixed-point price", () => { expect(decimalRatio(25_103_000_000_000_000n, 10n ** 18n)).toBe("0.025103"); });
});
