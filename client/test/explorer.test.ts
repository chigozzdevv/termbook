import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHouses, readOrders } from "../src/features/markets/data";
import { relativeTime } from "../src/lib/format";

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
