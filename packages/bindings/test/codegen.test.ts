import { describe, expect, it } from "vitest";
import { termbookCoreAbi, houseVaultAbi, settlementInboxAbi } from "../src/index.js";

describe("codegen", () => {
  it("exposes abis", () => {
    expect(termbookCoreAbi.length).toBeGreaterThan(0);
    expect(houseVaultAbi.length).toBeGreaterThan(0);
    expect(settlementInboxAbi.length).toBeGreaterThan(0);
  });
});
