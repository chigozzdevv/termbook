import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditApp } from "../src/app/app.js";

const creditId = `0x${"a".repeat(64)}` as `0x${string}`;
const positionId = `0x${"b".repeat(64)}`;
const marketId = `0x${"c".repeat(64)}`;
const client = { ready: async () => undefined, config: { apiBase: "https://api.example" } } as never;

afterEach(() => vi.unstubAllGlobals());

describe("SDK app state", () => {
  it("parses finalized position and pending identities", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("positions")
      ? { positions: [{ positionId, marketId }] }
      : { pending: [{ actionId: marketId, positionId, remainingLiability: "40", deadline: "100" }] } })));
    const app = new CreditApp(client, creditId);
    expect(await app.positions()).toEqual([{ positionId, marketId }]);
    expect(await app.pending()).toEqual([{ actionId: marketId, positionId, remainingLiability: 40n, deadline: 100n }]);
  });

  it("surfaces an unavailable reader instead of an empty collection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(new CreditApp(client, creditId).positions()).rejects.toThrow("application-state-unavailable");
  });
});
