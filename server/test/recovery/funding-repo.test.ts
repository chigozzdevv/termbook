import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoveryModel } from "../../src/recovery/recovery.model.js";
import { recoveryRepo } from "../../src/recovery/recovery.repo.js";

afterEach(() => vi.restoreAllMocks());

describe("recovery funding transaction reservation", () => {
  it("keeps the first signed transaction when two workers prepare the same operation", async () => {
    const operationId = `0x${"11".repeat(32)}`;
    const funder = `0x${"22".repeat(20)}`;
    const firstHash = `0x${"33".repeat(32)}`;
    const secondHash = `0x${"44".repeat(32)}`;
    const stored: Record<string, unknown> = { state: "pending", leaseToken: "lease" };
    vi.spyOn(RecoveryModel, "updateOne").mockImplementation(async (filter, update) => {
      const match = filter as { state: string; leaseToken: string; fundingTxHash: { $exists: boolean } };
      if (match.state !== stored["state"] || match.leaseToken !== stored["leaseToken"]
        || (match.fundingTxHash.$exists === false && stored["fundingTxHash"] !== undefined)) {
        return { matchedCount: 0 } as never;
      }
      Object.assign(stored, (update as { $set: Record<string, unknown> }).$set);
      return { matchedCount: 1 } as never;
    });

    const first = await recoveryRepo.prepareSubmission(operationId, "lease", funder, firstHash, "0x1234", 7);
    const second = await recoveryRepo.prepareSubmission(operationId, "lease", funder, secondHash, "0x5678", 8);
    expect(first.matchedCount).toBe(1);
    expect(second.matchedCount).toBe(0);
    expect(stored).toMatchObject({
      state: "prepared", fundingTxHash: firstHash, fundingRawTx: "0x1234", fundingNonce: 7,
    });
  });
});
