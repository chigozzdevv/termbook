import { describe, expect, it } from "vitest";
import type { House } from "../src/features/houses/types";
import type { Order } from "../src/features/orders/types";
import { filterHouses, filterOrders } from "../src/features/markets/filter";
import { canSupply, depositState } from "../src/features/houses/state";
import { quote } from "../src/features/supply/preview";

const address = `0x${"1".repeat(40)}`;
const base: House = { house: address, vault: address, manager: address, asset: address, active: true, paused: false,
  depositsOpen: true, unresolvedCreditImpairment: "0", freeCash: "48000000000", queuedWithdrawalAssets: "3000000000",
  committedCash: "10000000000", drawnPrincipal: "36000000000", availableCash: "45000000000", totalAssets: "94000000000",
  totalShares: "94000000000", sharePrice: "1000000000000000000", assetSymbol: "USDC", decimals: 6 };
const houses: House[] = [base, { ...base, house: `0x${"2".repeat(40)}`, freeCash: "900000000", queuedWithdrawalAssets: "0",
  availableCash: "900000000", committedCash: "0", drawnPrincipal: "0", totalAssets: "900000000" }];
const request: Order = { id: `0x${"a".repeat(64)}`, intentId: `0x${"a".repeat(64)}`, kind: "request", creditId: null,
  borrower: address, house: null, settlementAsset: address, settlementSymbol: "USDC", settlementDecimals: 6,
  limit: "100000000", debt: null, aprBps: null, maturity: null, facility: null, status: "open",
  collateral: { symbol: "SOL", chain: { label: "Solana devnet", namespace: "solana" }, asset: `0x${"0".repeat(64)}`,
    amount: "1000000000", decimals: 9 }, duration: 604800, createdAt: "2026-10-10T00:00:00.000Z", expiresAt: 1791856000, events: [] };
const orders: Order[] = [request, { ...request, id: `0x${"b".repeat(64)}`, kind: "credit", creditId: `0x${"b".repeat(64)}`,
  debt: "10000000", aprBps: 500, house: address, facility: "ready", status: "ready" }];

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

  it("preserves unit differences above JavaScript's safe integer range", () => {
    const result = filterHouses([
      { ...base, availableCash: "9007199254740993" },
      { ...base, availableCash: "9007199254740992" },
    ], { query: "", status: "all", sort: { key: "availableCash", direction: 1 } });
    expect(result[0].availableCash).toBe("9007199254740992");
  });

  it("falls back to the correct field type when switching table categories", () => {
    expect(filterOrders(orders, { query: "", status: "all", sort: { key: "availableCash", direction: -1 } })).toHaveLength(2);
    expect(filterHouses(houses, { query: "", status: "all", sort: { key: "createdAt", direction: -1 } })[0].availableCash).toBe("45000000000");
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

  it("calculates USDC shares and minimum shares", () => {
    expect(quote({ asset: "USDC", amount: "500" }, houses[0])).toEqual({
      received: "500000000",
      shares: 500000000n,
      minimum: 497500000n,
    });
  });

  it("preserves USDC base units and rejects excess precision", () => {
    expect(quote({ asset: "USDC", amount: "0.000001" }, houses[0]).shares).toBe(1n);
    expect(() => quote({ asset: "USDC", amount: "0.0000001" }, houses[0])).toThrow();
  });

  it.each([1e30, Number.POSITIVE_INFINITY, 0, 1e-20])(
    "rejects unusable supply amounts: %s",
    (amount) => {
      expect(() => quote({ asset: "USDC", amount }, houses[0])).toThrow();
    },
  );
});
