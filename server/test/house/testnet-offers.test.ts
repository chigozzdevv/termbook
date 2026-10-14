import { afterEach, describe, expect, it, vi } from "vitest";
import { testnetOfferConfig, testnetOfferLimit } from "../../src/house/testnet-offers.worker.js";
import { env } from "../../src/config/env.js";

const policy = [1n, 5_000_000n, 60n, 86400n, 1000n, 0n, 0n, 12500n, 12000n, 11750n, 11500n, 11000n, true, true];
const request = () => ({ status: "open", used: false, duration: 86400, expiresAt: Math.floor(Date.now() / 1000) + 900, actionFunding: "10000" });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("testnet House offers", () => {
  it("offers the actual action funding within a House's duration and cash limits", () => {
    expect(testnetOfferLimit(request(), policy, 100_000n, 1_000_000n)).toBe(10_000n);
  });
  it.each([
    { duration: 30 * 86400 }, { duration: 59 }, { actionFunding: "100001" }, { actionFunding: "0" },
    { limit: "9999" }, { used: true }, { status: "used" }, { expiresAt: 1 },
  ])("does not silently change an ineligible request: %j", (change) => {
    expect(testnetOfferLimit({ ...request(), ...change }, policy, 100_000n, 1_000_000n)).toBeUndefined();
  });
  it("does not quote more cash than the House has available or lend from a paused House", () => {
    expect(testnetOfferLimit(request(), policy, 100_000n, 9999n)).toBeUndefined();
    expect(testnetOfferLimit(request(), [...policy.slice(0, 13), false], 100_000n, 1_000_000n)).toBeUndefined();
  });
  it("is opt in and refuses production use", () => {
    vi.stubEnv("TESTNET_HOUSE_OFFERS", "");
    expect(testnetOfferConfig()).toEqual([]);
    vi.stubEnv("TESTNET_HOUSE_OFFERS", "[]");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => testnetOfferConfig()).toThrow("testnet-house-offers-forbidden");
  });
  it("refuses a mainnet chain even with an operator configured", () => {
    vi.stubEnv("TESTNET_HOUSE_OFFERS", "[]");
    const previous = env.monadChainId;
    env.monadChainId = 143;
    try { expect(() => testnetOfferConfig()).toThrow("testnet-house-offers-forbidden"); }
    finally { env.monadChainId = previous; }
  });
});
