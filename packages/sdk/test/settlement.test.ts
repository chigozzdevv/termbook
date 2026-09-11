import { describe, expect, it } from "vitest";
import { unconsumed } from "../src/settlement/receipt.js";

describe("settlement", () => {
  it("tracks shortfall", () => {
    expect(unconsumed({ received: 900n, applied: 900n, refunded: 0n })).toBe(0n);
  });
});
