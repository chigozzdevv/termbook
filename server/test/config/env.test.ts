import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("runtime configuration", () => {
  it("restricts local application origins to explicit admin-operated testnet development", async () => {
    vi.stubEnv("CORE_ADDRESS", `0x${"11".repeat(20)}`);
    vi.stubEnv("CORE_DOMAIN", `0x${"22".repeat(32)}`);
    vi.stubEnv("MONAD_CHAIN_ID", "10143"); vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_WALLETS", `0x${"33".repeat(20)}`); vi.stubEnv("LOCAL_APP_ORIGINS", "http://localhost:3000");
    const { assertRuntimeConfig, env } = await import("../../src/config/env.js");
    expect(assertRuntimeConfig).not.toThrow();
    for (const origin of ["https://localhost:3000", "http://localhost", "http://localhost:3000/path", "http://192.168.1.1:3000",
      "http://user:pass@localhost:3000"]) {
      env.localAppOrigins = [origin]; expect(assertRuntimeConfig).toThrow("local-application-config-invalid");
    }
    env.localAppOrigins = ["http://localhost:3000"]; env.monadChainId = 143;
    expect(assertRuntimeConfig).toThrow("local-application-config-invalid");
    env.monadChainId = 10143; vi.stubEnv("NODE_ENV", "production");
    expect(assertRuntimeConfig).toThrow("local-application-config-invalid");
    vi.stubEnv("NODE_ENV", "development"); env.adminWallets = [];
    expect(assertRuntimeConfig).toThrow("local-application-config-invalid");
  });
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
