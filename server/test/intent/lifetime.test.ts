import { describe, expect, it, vi } from "vitest";
import { intentService } from "../../src/intent/intent.service.js";
import { intentRepo } from "../../src/intent/intent.repo.js";
import { constants } from "../../src/config/constants.js";

vi.mock("../../src/intent/intent.repo.js", () => ({ intentRepo: { create: vi.fn() } }));

describe("intent lifetime", () => {
  it("expires offer discovery independently of the requested credit duration", async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await intentService.create({ borrower: `0x${"1".repeat(40)}`, chainId: 143,
      asset: `0x${"2".repeat(40)}`, amount: "100", duration: 365 * 86400, limit: "100" }, `0x${"a".repeat(64)}`,
    0n, `0x${"3".repeat(40)}`);
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + constants.intentLifetimeSeconds);
    expect(result.expiresAt).toBeLessThanOrEqual(before + constants.intentLifetimeSeconds + 1);
    expect(intentRepo.create).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: result.expiresAt }));
  });
});
