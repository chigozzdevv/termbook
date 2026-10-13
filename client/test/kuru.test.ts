import { describe, expect, it } from "vitest";
import { amountUnits, estimate, candles, chartTimeline } from "../src/features/kuru/amount";
import type { Trade } from "../src/features/kuru/data";
import { chartSchema, chartSource } from "../src/features/kuru/data";

const book = { fee_bps: 30, asks: [{ price: "2", size: "3" }, { price: "3", size: "2" }], bids: [{ price: "1.9", size: "3" }, { price: "1.8", size: "2" }] };
describe("Kuru trading amounts", () => {
  it("converts USDC and MON exactly", () => {
    expect(amountUnits("0.1", 6)).toBe(100_000n);
    expect(amountUnits("1.000000000000000001", 18)).toBe(1_000_000_000_000_000_001n);
  });
  it.each(["0", "-1", "1e2", "NaN", "Infinity", "1.0000001", "0.0000009", " 1", "1."])("rejects ambiguous or overprecise USDC: %s", (text) => {
    expect(amountUnits(text, 6)).toBeUndefined();
  });
  it("rejects a uint128 overflow", () => {
    expect(amountUnits(String(2n ** 128n), 6)).toBeUndefined();
  });
  it("walks multiple ask levels for a buy and applies fees and slippage", () => {
    expect(estimate(book, "buy", 9_000_000n, 100)).toEqual({ output: "3.988", minimum: "3.94812" });
  });
  it("walks multiple bid levels for a sale into USDC", () => {
    expect(estimate(book, "sell", 4n * 10n ** 18n, 50)).toEqual({ output: "7.4775", minimum: "7.440112" });
  });
  it("does not invent a fill beyond the available depth", () => {
    expect(estimate(book, "buy", 13_000_000n, 50)).toBeUndefined();
    expect(estimate(book, "sell", 6n * 10n ** 18n, 50)).toBeUndefined();
  });
  it("rejects an invalid slippage bound", () => {
    expect(estimate(book, "buy", 1n, -1)).toBeUndefined();
    expect(estimate(book, "buy", 1n, 1.5)).toBeUndefined();
  });
});

describe("Kuru chart provenance", () => {
  const response = { chain_id: 143, market_id: "0x065c9d28e428a0db40191a54d33d5b7c71a9c394", interval: 15,
    source_url: chartSource, timestamp: 1800,
    candles: [{ time: 900, open: "0.02", high: "0.03", low: "0.019", close: "0.025", volume: "10" }] };
  it("accepts only the chosen Kuru mainnet market as the chart source", () => {
    expect(chartSchema.safeParse(response).success).toBe(true);
    expect(chartSchema.safeParse({ ...response, chain_id: 10143 }).success).toBe(false);
    expect(chartSchema.safeParse({ ...response, market_id: `0x${"1".repeat(40)}` }).success).toBe(false);
  });
  it("rejects impossible candles and duplicate or misaligned times", () => {
    expect(chartSchema.safeParse({ ...response, candles: [{ ...response.candles[0], high: "0.01" }] }).success).toBe(false);
    expect(chartSchema.safeParse({ ...response, candles: [...response.candles, ...response.candles] }).success).toBe(false);
    expect(chartSchema.safeParse({ ...response, candles: [{ ...response.candles[0], time: 901 }] }).success).toBe(false);
  });
});

describe("Kuru finalized trade candles", () => {
  const trade = (time: number, price: string, index: number): Trade => ({ id: `0x${"a".repeat(64)}:${index}`,
    tx: `0x${"a".repeat(64)}`, time, block: "10", direction: "buy", price, size: "2" });
  it("uses canonical log order and keeps intervals without trades empty", () => {
    const bars = candles([trade(120, "3", 2), trade(60, "2", 1), trade(60, "1", 0), trade(360, "4", 3)], 1);
    expect(bars).toEqual([
      { time: 60, open: 1, high: 2, low: 1, close: 2, volume: 4 },
      { time: 120, open: 3, high: 3, low: 3, close: 3, volume: 2 },
      { time: 360, open: 4, high: 4, low: 4, close: 4, volume: 2 },
    ]);
  });
  it("preserves time gaps without inventing prices or trading volume", () => {
    const bars = candles([trade(60, "2", 0), trade(240, "3", 1)], 1);
    expect(chartTimeline(bars, 1)).toEqual([bars[0], { time: 120 }, { time: 180 }, bars[1]]);
    expect(chartTimeline([], 1)).toEqual([]);
  });
  it("bounds sparse history to the latest 2001 intervals", () => {
    const bars = candles([trade(60, "2", 0), trade(600_060, "3", 1)], 1);
    const points = chartTimeline(bars, 1);
    expect(points).toHaveLength(2001);
    expect(points[0]).toEqual({ time: 480_060 });
    expect(points.at(-1)).toEqual(bars[1]);
  });
});
