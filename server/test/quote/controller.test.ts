import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { quoteController } from "../../src/quote/quote.controller.js";
import { quoteService } from "../../src/quote/quote.service.js";

vi.mock("../../src/quote/quote.service.js", () => ({ quoteService: { record: vi.fn() } }));

const address = `0x${"1".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;
const quote = {
  intentId: hash, borrower: address, house: address, vault: address, owner: address,
  sourceChain: 1, collateralVault: address, collateralAsset: address,
  collateralAmount: "100", returnRecipient: address, settlementAsset: address,
  limit: "200", aprBps: 100, maturity: 300, setupDeadline: 200, grace: 10,
  nonce: "1", expiry: 100, bundleId: hash, termsHash: hash, signature: "0xab", domain: hash,
};

function request(wallet?: string): FastifyRequest {
  return { body: quote, user: wallet ? { wallet } : undefined } as unknown as FastifyRequest;
}

beforeEach(() => vi.clearAllMocks());

describe("quote relay", () => {
  it("allows an authenticated relayer to submit a signed House quote", async () => {
    vi.mocked(quoteService.record).mockResolvedValue({ quoteId: "q" } as never);
    expect(await quoteController.record(request(`0x${"2".repeat(40)}`))).toEqual({ quoteId: "q" });
    expect(quoteService.record).toHaveBeenCalledWith(expect.objectContaining({ house: address }));
  });

  it("rejects an unauthenticated relayer", async () => {
    await expect(quoteController.record(request())).rejects.toThrow("permission-denied");
    expect(quoteService.record).not.toHaveBeenCalled();
  });
});
