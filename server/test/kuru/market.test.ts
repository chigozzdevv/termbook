import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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


describe("Kuru mainnet price chart", () => {
  const timestamp = 1_791_900_000;
  const request = vi.fn();
  const fixture = () => ({ success: true, timestamp: timestamp * 1000, data: { data: { s: "ok",
    t: [timestamp - 1800, timestamp - 900], o: ["0.02000000000000000000", "0.025"],
    h: ["0.03", "0.026"], l: ["0.019", "0.024"], c: ["0.025", "0.026"], v: ["10.123456789", "0"] } } });
  beforeEach(() => {
    vi.resetModules(); request.mockReset(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(timestamp * 1000);
    vi.stubGlobal("fetch", request); request.mockImplementation(async () => Response.json(fixture()));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("uses Kuru's mainnet history feed and preserves its prices and volume", async () => {
    const { marketChart, chartMarket } = await import("../../src/kuru/chart.service.js");
    const data = await marketChart(15);
    expect(data).toMatchObject({ chain_id: 143, market_id: chartMarket, interval: 15, timestamp,
      candles: [{ time: timestamp - 1800, open: "0.02000000000000000000", high: "0.03", low: "0.019", close: "0.025", volume: "10.123456789" },
        { time: timestamp - 900, volume: "0" }] });
    const url = new URL(request.mock.calls[0]![0]);
    expect(url.origin).toBe("https://api.kuru.io");
    expect(url.pathname).toBe(`/api/v2/${chartMarket}/trades/history`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ countback: "500", resolution: "15m", isDollar: "false", inMarketCap: "false" });
  });
  it("deduplicates concurrent requests, caches briefly and keeps intervals separate", async () => {
    const { marketChart } = await import("../../src/kuru/chart.service.js");
    await Promise.all([marketChart(15), marketChart(15)]); await marketChart(15);
    expect(request).toHaveBeenCalledTimes(1);
    await marketChart(1); expect(request).toHaveBeenCalledTimes(2);
    vi.setSystemTime((timestamp + 11) * 1000);
    await marketChart(15); expect(request).toHaveBeenCalledTimes(3);
    await expect(marketChart(7)).rejects.toThrow("kuru-chart-interval-invalid");
  });
  it("includes Kuru's opening price in the candle range without changing close or volume", async () => {
    const { marketChart } = await import("../../src/kuru/chart.service.js");
    const data = fixture(); data.data.data.l[0] = "0.022"; data.data.data.o[1] = "0.028";
    request.mockResolvedValue(Response.json(data));
    const { candles } = await marketChart(15);
    expect(candles[0]).toMatchObject({ low: "0.02000000000000000000", close: "0.025", volume: "10.123456789" });
    expect(candles[1]).toMatchObject({ high: "0.028", close: "0.026", volume: "0" });
  });
  it.each(["length", "bounds", "duplicate", "alignment", "future", "negative", "stale"])("rejects invalid upstream data: %s", async (issue) => {
    const { marketChart } = await import("../../src/kuru/chart.service.js");
    const data = fixture(), series = data.data.data;
    if (issue === "length") series.v.pop();
    if (issue === "bounds") series.h[0] = "0.01";
    if (issue === "duplicate") series.t[1] = series.t[0]!;
    if (issue === "alignment") series.t[0]!++;
    if (issue === "future") series.t[1] = timestamp + 900;
    if (issue === "negative") series.v[0] = "-1";
    if (issue === "stale") data.timestamp -= 61_000;
    request.mockResolvedValue(Response.json(data));
    await expect(marketChart(15)).rejects.toThrow();
  });
  it("backs off failed requests without presenting them as empty or fresh history", async () => {
    const { marketChart } = await import("../../src/kuru/chart.service.js");
    request.mockResolvedValue(new Response("", { status: 429 }));
    await expect(marketChart(15)).rejects.toThrow("kuru-chart-unavailable");
    await expect(marketChart(15)).rejects.toThrow("kuru-chart-unavailable");
    expect(request).toHaveBeenCalledTimes(1);
    vi.setSystemTime((timestamp + 6) * 1000);
    request.mockImplementation(async () => Response.json(fixture()));
    expect((await marketChart(15)).candles).toHaveLength(2);
  });
  it("accepts an explicit no-data response without inventing candles", async () => {
    const { marketChart } = await import("../../src/kuru/chart.service.js");
    request.mockResolvedValue(Response.json({ success: true, timestamp: timestamp * 1000, data: { data: { s: "no_data" } } }));
    expect((await marketChart(15)).candles).toEqual([]);
  });
});
