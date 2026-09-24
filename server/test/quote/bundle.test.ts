import { beforeEach, describe, expect, it, vi } from "vitest";
import { intentRepo } from "../../src/intent/intent.repo.js";
import { quoteService } from "../../src/quote/quote.service.js";

vi.mock("../../src/intent/intent.repo.js", () => ({ intentRepo: { get: vi.fn() } }));
vi.mock("../../src/quote/quote.repo.js", () => ({ quoteRepo: { list: vi.fn(), save: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe("quote application binding", () => {
  it("rejects a quote from another integration before signature processing", async () => {
    vi.mocked(intentRepo.get).mockResolvedValue({ borrower: `0x${"1".repeat(40)}`,
      bundleId: `0x${"a".repeat(64)}`, expiresAt: Math.floor(Date.now() / 1000) + 600 } as never);
    await expect(quoteService.record({ intentId: `0x${"2".repeat(64)}`,
      borrower: `0x${"1".repeat(40)}`, bundleId: `0x${"b".repeat(64)}`,
      expiry: Math.floor(Date.now() / 1000) + 300 }))
      .rejects.toThrow("quote-bundle-mismatch");
  });
});
