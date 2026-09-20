import { describe, expect, it } from "vitest";
import { collateralSelectSchema } from "../src/intent.js";
import { quoteSchema } from "../src/quote.js";
import { operationSchema } from "../src/settlement.js";

describe("schema", () => {
  it("rejects bad address", () => {
    expect(() => collateralSelectSchema.parse({ chainId: 1, asset: "bad", amount: 1n })).toThrow();
  });

  it("accepts quote", () => {
    const q = {
      id: "q1",
      borrower: "0x0000000000000000000000000000000000000001",
      house: "0x0000000000000000000000000000000000000002",
      vault: "0x0000000000000000000000000000000000000003",
      limit: 1000n,
      maturity: 9999999999,
      expiry: 9999999999,
      bundleId: "0x0000000000000000000000000000000000000000000000000000000000000001",
      termsHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
      aprBps: 500,
    };
    expect(quoteSchema.parse(q).id).toBe("q1");
  });

  it("requires operation identity fields", () => {
    const operation = {
      operationId: `0x${"1".repeat(64)}`,
      kind: "repay" as const,
      payer: `0x${"1".repeat(40)}`,
      nonce: 1n,
      sourceChain: 1,
      sourceAsset: `0x${"2".repeat(40)}`,
      maxAmountIn: 100n,
      vault: `0x${"3".repeat(40)}`,
      creditId: `0x${"4".repeat(64)}`,
      minAmountOut: 90n,
      deadline: 9999999999,
      refundRecipient: `0x${"5".repeat(40)}`,
    };
    expect(operationSchema.parse(operation).nonce).toBe(1n);
    expect(() => operationSchema.parse({ ...operation, minAmountOut: -1n })).toThrow();
  });
});
