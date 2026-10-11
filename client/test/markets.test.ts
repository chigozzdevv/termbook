import { describe, expect, it } from "vitest";
import { houses } from "../src/features/houses/mock";
import { orders } from "../src/features/orders/mock";
import { filterHouses, filterOrders } from "../src/features/markets/filter";
import { canSupply, depositState } from "../src/features/houses/state";
import { quote } from "../src/features/supply/preview";

describe("Market records", () => {
  it("combines collateral search and facility status", () => {
    const result = filterOrders(orders, {
      query: "SOL",
      status: "ready",
      sort: { key: "createdAt", direction: -1 },
    });
    expect(result).toHaveLength(1);
    expect(result[0].collateral.symbol).toBe("SOL");
    expect(result[0].status).toBe("ready");
  });

  it("sorts integer amounts numerically without mutating fixtures", () => {
    const before = houses.map((house) => house.house);
    const result = filterHouses(houses, {
      query: "",
      status: "all",
      sort: { key: "availableCash", direction: 1 },
    });
    expect(result[0].availableCash).toBe("900000000");
    expect(result.at(-1)?.availableCash).toBe("45000000000");
    expect(houses.map((house) => house.house)).toEqual(before);
  });

  it("preserves requests without facility debt, rate or house", () => {
    expect(
      orders
        .filter((order) => order.kind === "request")
        .every((order) => order.debt === null && order.aprBps === null && order.house === null),
    ).toBe(true);
  });

  it("keeps the House balance breakdown consistent", () => {
    for (const house of houses) {
      expect(BigInt(house.availableCash)).toBe(
        BigInt(house.freeCash) - BigInt(house.queuedWithdrawalAssets),
      );
      expect(BigInt(house.totalAssets)).toBe(
        BigInt(house.freeCash) + BigInt(house.committedCash) + BigInt(house.drawnPrincipal),
      );
    }
  });

  it("blocks inactive, paused, closed and impaired Houses from supply", () => {
    const base = houses[0];
    expect(canSupply(base)).toBe(true);
    for (const override of [
      { active: false },
      { paused: true },
      { depositsOpen: false },
      { unresolvedCreditImpairment: "1" },
    ]) {
      expect(canSupply({ ...base, ...override })).toBe(false);
    }
    expect(depositState({ ...base, unresolvedCreditImpairment: "1" })).toBe("Restricted");
  });

  it("uses the approved WETH mock quote and minimum shares", () => {
    expect(quote({ asset: "WETH", amount: 0.2 }, houses[0])).toEqual({
      received: "500000000",
      shares: 500000000n,
      minimum: 497500000n,
    });
  });

  it.each([1e30, Number.POSITIVE_INFINITY, 0, 1e-20])(
    "rejects unusable supply amounts: %s",
    (amount) => {
      expect(() => quote({ asset: "USDC", amount }, houses[0])).toThrow();
    },
  );
});
