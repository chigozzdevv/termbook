import { describe, expect, it } from "vitest";
import { collateralSelectSchema } from "../src/intent.js";
import { quoteSchema } from "../src/quote.js";

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
});
