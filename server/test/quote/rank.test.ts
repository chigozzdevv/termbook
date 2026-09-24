import { describe, expect, it } from "vitest";
import { rankQuotes } from "../../src/quote/rank.js";

const now = 2_000_000_000;
const borrower = `0x${"1".repeat(40)}`;
const bundleId = `0x${"a".repeat(64)}`;
const settlementAsset = `0x${"b".repeat(40)}`;
const intent = { borrower, bundleId, settlementAsset, actionFunding: "700000000", duration: 365 * 86400 };

function quote(id: string, terms: Record<string, unknown> = {}) {
  return { quoteId: id, borrower, bundleId, settlementAsset, house: `0x${id.repeat(40)}`, limit: "900000000",
    originationFee: "0", aprBps: 500, commitmentFeeBps: 0, expiry: now + 300,
    setupDeadline: now + 300, maturity: now + 366 * 86400, ...terms };
}

describe("comparable House offers", () => {
  it("ranks the same funded action by total cost, including fixed and commitment fees", () => {
    const offers = rankQuotes(intent, [
      quote("1", { aprBps: 400, originationFee: "10000000" }),
      quote("2", { aprBps: 500 }),
      quote("3", { aprBps: 300, commitmentFeeBps: 3000 }),
    ], now);
    expect(offers.map((offer) => offer.id)).toEqual(["2", "1", "3"]);
    expect(offers[0]?.costAssumptions).toMatchObject({ draw: "700000000", durationSeconds: 365 * 86400 });
    expect(offers[0]?.estimatedTotalCost).toBe("35000000");
  });

  it("rejects offers that cannot fund the action for the requested duration", () => {
    const offers = rankQuotes(intent, [quote("1", { limit: "700000000", originationFee: "1" }),
      quote("2", { maturity: now + 86400 }), quote("3", { expiry: now })], now);
    expect(offers).toEqual([]);
  });

  it("uses one common draw assumption when the borrower requests a limit without an action", () => {
    const offers = rankQuotes({ ...intent, actionFunding: "0" }, [
      quote("1", { limit: "800000000", originationFee: "10000000" }),
      quote("2", { limit: "900000000" }),
    ], now);
    expect(offers).toHaveLength(2);
    expect(offers[0]?.costAssumptions?.draw).toBe("790000000");
    expect(offers[1]?.costAssumptions?.draw).toBe("790000000");
  });
});
