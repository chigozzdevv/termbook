import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { alreadyConfigured, configuration } from "../../../scripts/testnet/state.mjs";

afterEach(() => vi.restoreAllMocks());

describe("testnet configuration", () => {
  it("retains upgrade baselines while dropping completed transaction data", () => {
    const baseline = { implementation: "0x1234", storageLayout: { storage: [] }, abi: [] };
    expect(configuration({ proxies: { Core: baseline }, transactions: [{ rawTransaction: "signed" }],
      runtime: { balance: "stale" }, previousDeployment: "retired", configuration: { setup: { contractPins: { Guard: "hash" } } } }))
      .toEqual({ proxies: { Core: baseline }, configuration: { setup: { contractPins: { Guard: "hash" } } } });
  });

  it("rejects nested secrets in public configuration", () => {
    expect(() => configuration({ configuration: { keeper: { privateKey: "secret" } } })).toThrow("Private data");
  });

  it("prevents replay only when setup completed for the current Core", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const value = { addresses: { 10143: { TermbookCore: "0xNEW" } },
      configuration: { setup: { completedAt: "today", core: "0xnew" } } };
    const read = vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(value));
    expect(alreadyConfigured("setup")).toBe(true);
    value.configuration.setup.core = "0xold";
    read.mockReturnValue(JSON.stringify(value));
    expect(alreadyConfigured("setup")).toBe(false);
    value.configuration.setup.core = "0xnew";
    value.configuration.setup.completedAt = "";
    read.mockReturnValue(JSON.stringify(value));
    expect(alreadyConfigured("setup")).toBe(false);
  });
});
