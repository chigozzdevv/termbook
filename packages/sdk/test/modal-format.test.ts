import { describe, expect, it } from "vitest";
import { amountText, money, parseAmount } from "../src/modal/modal-ui.js";

describe("modal amounts", () => {
  it("formats token decimals without converting balances through floating point", () => {
    expect(money(205_800_000n, { address: `0x${"11".repeat(20)}`, symbol: "USDC", decimals: 6 })).toBe("205.8 USDC");
    expect(amountText(9007199254740993123456n, 6)).toBe("9,007,199,254,740,993.123456");
    expect(amountText(350000000000000000n, 18)).toBe("0.35");
    expect(amountText(0n, 6)).toBe("0");
  });
  it("marks shortened fractional precision as approximate", () => {
    expect(amountText(1234567890123456789n, 18)).toBe("≈ 1.234567");
    expect(amountText(1n, 18)).toBe("< 0.000001");
    expect(amountText(1000000000000n, 18)).toBe("0.000001");
  });
  it("converts decimal inputs exactly and rejects excess precision instead of rounding", () => {
    expect(parseAmount("100.25", 6)).toBe(100250000n);
    expect(parseAmount("0.35", 18)).toBe(350000000000000000n);
    expect(parseAmount("0.5", 2)).toBe(50n);
    expect(parseAmount("7", 0)).toBe(7n);
    for (const value of ["1.0000001", "-1", "1e6", "", "NaN", "1,000"]) expect(() => parseAmount(value, 6)).toThrow();
    expect(() => parseAmount("1.1", 0)).toThrow();
  });
});
