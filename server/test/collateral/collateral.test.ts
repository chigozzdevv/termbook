import { describe, expect, it } from "vitest";
import { collateralSchema } from "../../src/collateral/collateral.schema.js";

describe("collateral tracking", () => {
  const input = {
    lockId: `0x${"11".repeat(32)}`,
    creditId: `0x${"22".repeat(32)}`,
    amount: "100",
    owner: `0x${"33".repeat(20)}`,
  };

  it("rejects caller-selected proof endpoints", () => {
    expect(collateralSchema.safeParse({ ...input, sourceRpc: "http://127.0.0.1:8080" }).success).toBe(false);
    expect(collateralSchema.safeParse(input).success).toBe(true);
  });

  it("normalizes lock and credit identifiers before persistence", () => {
    const parsed = collateralSchema.parse({
      ...input,
      lockId: `0x${"AB".repeat(32)}`,
      owner: `0x${"CD".repeat(20)}`,
    });
    expect(parsed.lockId).toBe(`0x${"ab".repeat(32)}`);
    expect(parsed.owner).toBe(`0x${"cd".repeat(20)}`);
  });
});
