import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHouses, readOrders } from "../src/features/markets/data";
import { relativeTime } from "../src/lib/format";
import { houseStats } from "../src/features/houses/stats";
import type { House } from "../src/features/houses/types";

const fetcher = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetcher));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); fetcher.mockReset(); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe("Live explorer loading", () => {
  it("returns empty real data without substituting client records", async () => {
    fetcher.mockResolvedValue(response({ records: [], total: 0, next: null, block: "10" }));
    expect(await readOrders()).toEqual({ records: [], total: 0 });
    expect(fetcher.mock.calls[0][0]).toContain("/explorer/orders");
    expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
  });
  it("propagates unavailable APIs instead of fabricating an empty or populated result", async () => {
    fetcher.mockResolvedValue(response({ error: "explorer-unavailable" }, 503));
    await expect(readOrders()).rejects.toThrow("Request failed (503)");
    await expect(readHouses()).rejects.toThrow("Request failed (503)");
  });
  it("rejects malformed House balances instead of assuming zero", async () => {
    fetcher.mockResolvedValue(response([{ house: "invalid", availableCash: "10" }]));
    await expect(readHouses()).rejects.toThrow();
  });
  it("uses the current clock for relative transaction dates", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-13T12:00:00Z"));
    expect(relativeTime("2026-10-13T11:58:00Z")).toBe("2 min ago");
    expect(relativeTime("2026-10-13T12:00:03Z")).toBe("0 sec ago");
  });
});

describe("House statistics", () => {
  const house = (overrides: Partial<House> = {}): House => ({
    house: `0x${"1".repeat(40)}`, vault: `0x${"2".repeat(40)}`, manager: `0x${"3".repeat(40)}`,
    asset: `0x${"4".repeat(40)}`, assetSymbol: "USDC", decimals: 6, active: true, paused: false,
    depositsOpen: true, unresolvedCreditImpairment: "0", freeCash: "7000000", queuedWithdrawalAssets: "1000000",
    committedCash: "2000000", drawnPrincipal: "3000000", availableCash: "6000000", totalAssets: "12000000",
    totalShares: "12000000", sharePrice: "1000000000000000000", ...overrides,
  });
  it("excludes paused and inactive Houses from available lending while retaining their assets and loans", () => {
    expect(houseStats([house(), house({ paused: true }), house({ active: false })])).toMatchObject([
      { total: 36000000n, available: 6000000n, reserved: 6000000n, principal: 9000000n },
    ]);
  });
  it("keeps distinct tokens separate and sums token units without floating point loss", () => {
    const result = houseStats([house({ totalAssets: "9007199254740993" }), house({ totalAssets: "1" }),
      house({ asset: `0x${"5".repeat(40)}`, decimals: 18, totalAssets: "1000000000000000000" })]);
    expect(result).toHaveLength(2);
    expect(result[0].total).toBe(9007199254740994n);
    expect(result[1].total).toBe(1000000000000000000n);
  });
});
