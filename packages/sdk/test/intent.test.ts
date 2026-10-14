import { describe, expect, it, vi } from "vitest";
import { requiredDraw, fundingNeed, checkCapacity } from "../src/credit/draw.js";
import { unconsumed, reportShortfall } from "../src/settlement/receipt.js";
import { slippageBound } from "../src/app/app.js";
import { operationId, checkQuoteForOperation } from "../src/settlement/operation.js";
import { Intent, type Offer } from "../src/intent/intent.js";
import type { TermbookClient } from "../src/client/client.js";

describe("waiting for House offers", () => {
  it("waits for the same request until its House responds", async () => {
    vi.useFakeTimers();
    try {
      const intent = new Intent({} as TermbookClient);
      const offers = [{ id: "offer" }] as Offer[];
      const read = vi.spyOn(intent, "offers").mockResolvedValueOnce([]).mockResolvedValueOnce(offers);
      const pending = intent.waitForOffers();
      await vi.advanceTimersByTimeAsync(2500);
      expect(await pending).toEqual(offers);
      expect(read).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("stops polling when the modal closes", async () => {
    vi.useFakeTimers();
    try {
      const intent = new Intent({} as TermbookClient), controller = new AbortController();
      const read = vi.spyOn(intent, "offers").mockResolvedValue([]);
      const pending = intent.waitForOffers({ signal: controller.signal });
      const rejected = expect(pending).rejects.toThrow("closed");
      await vi.advanceTimersByTimeAsync(1);
      controller.abort(new Error("closed"));
      await rejected;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(read).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("returns an empty result after the bounded waiting period", async () => {
    vi.useFakeTimers();
    try {
      const intent = new Intent({} as TermbookClient);
      vi.spyOn(intent, "offers").mockResolvedValue([]);
      const pending = intent.waitForOffers({ timeoutMs: 5000 });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe("intent use case", () => {
  it("rejects a mismatch before requesting API authorization and preserves matching actions", async () => {
    const address = `0x${"1".repeat(40)}` as const;
    const id = `0x${"2".repeat(64)}` as const;
    const authenticatedPost = vi.fn(async () => ({ intentId: id }));
    const client = { ready: async () => {}, config: { use_case: "perps", apiBase: "https://api.termbook.example" },
      signer: { address: () => address }, authenticatedPost } as unknown as TermbookClient;
    const request = { collateral: { chainId: 143, asset: address, amount: 100n }, credit: { duration: 86400 },
      action: { use_case: "spot" as const, capability: "place_order" as const, params: { market_id: "MON-USDC", direction: "buy" as const, order_type: "market" as const, amount: { spend: "100" }, slippage_bps: 50 } } };
    await expect(new Intent(client, request).submit()).rejects.toThrow("action-use-case-mismatch");
    expect(authenticatedPost).not.toHaveBeenCalled();
    const action = { use_case: "perps" as const, capability: "place_order" as const, params: { market_id: "MON-USDC", direction: "long" as const, order_type: "market" as const, amount: { margin: "100", notional: "500" }, slippage_bps: 50 } };
    await expect(new Intent(client, { ...request, action }).submit()).resolves.toBe(id);
    expect(authenticatedPost).toHaveBeenCalledWith("/intents", expect.objectContaining({ action }));
  });
});

describe("draw", () => {
  it("computes required draw", () => {
    expect(requiredDraw(700n, 200n)).toBe(500n);
    expect(requiredDraw(700n, 800n)).toBe(0n);
  });

  it("funds 705 need on 700 limit", () => {
    const { need, draw } = fundingNeed(700n, 5n, 0n);
    expect(need).toBe(705n);
    expect(draw).toBe(705n);
    expect(() => checkCapacity(draw, 700n, 0n, true, 0n)).toThrow();
  });

  it("rejects negative", () => {
    expect(() => requiredDraw(-1n, 0n)).toThrow();
  });
});

describe("receipt", () => {
  it("computes unconsumed", () => {
    expect(unconsumed({ received: 1000n, applied: 900n, refunded: 0n })).toBe(100n);
  });

  it("rejects double spend", () => {
    expect(() => unconsumed({ received: 100n, applied: 90n, refunded: 20n })).toThrow();
  });

  it("reports shortfall", () => {
    expect(reportShortfall(1000n, 900n)).toEqual({ shortfall: 100n, partial: true });
    expect(reportShortfall(900n, 900n).partial).toBe(false);
  });
});

describe("slippage", () => {
  it("bounds max and min", () => {
    expect(slippageBound(1000n, 50, true)).toBe(1005n);
    expect(slippageBound(1000n, 50, false)).toBe(995n);
  });

  it("rejects over 10000", () => {
    expect(() => slippageBound(1000n, 10001, true)).toThrow();
  });
});

describe("operation", () => {
  it("derives stable id", () => {
    const a = operationId("repay", "0x0000000000000000000000000000000000000001", 1n, 1);
    const b = operationId("repay", "0x0000000000000000000000000000000000000001", 1n, 1);
    expect(a).toBe(b);
  });

  it("rejects short quote", () => {
    expect(() => checkQuoteForOperation(1000n, 900n, 2000n, 1000n)).toThrow();
    expect(() => checkQuoteForOperation(900n, 900n, 1000n, 1100n)).toThrow();
  });
});
