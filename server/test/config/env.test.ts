import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("runtime configuration", () => {
  it("accepts the three required Ethereum Beacon worker settings", async () => {
    vi.stubEnv("CORE_ADDRESS", `0x${"11".repeat(20)}`);
    vi.stubEnv("CORE_DOMAIN", `0x${"22".repeat(32)}`);
    vi.stubEnv("MONAD_CHAIN_ID", "143");
    vi.stubEnv("ETHEREUM_LIGHT_CLIENT_ADDRESS", `0x${"33".repeat(20)}`);
    vi.stubEnv("ETHEREUM_BEACON_API_URL", "https://beacon.example");
    vi.stubEnv("ETHEREUM_BEACON_KEEPER_KEY", `0x${"44".repeat(32)}`);
    const { assertRuntimeConfig } = await import("../../src/config/env.js");
    expect(assertRuntimeConfig).not.toThrow();
  });

  it("accepts a Beacon API for collateral proofs without a Beacon relay key", async () => {
    vi.stubEnv("CORE_ADDRESS", `0x${"11".repeat(20)}`);
    vi.stubEnv("CORE_DOMAIN", `0x${"22".repeat(32)}`);
    vi.stubEnv("MONAD_CHAIN_ID", "143");
    vi.stubEnv("SOURCE_RPC_URL", "https://ethereum.example");
    vi.stubEnv("ETHEREUM_BEACON_API_URL", "https://beacon.example");
    vi.stubEnv("COLLATERAL_KEEPER_KEY", `0x${"44".repeat(32)}`);
    const { assertRuntimeConfig } = await import("../../src/config/env.js");
    expect(assertRuntimeConfig).not.toThrow();
  });
});
