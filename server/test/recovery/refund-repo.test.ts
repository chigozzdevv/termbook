import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoveryRefundModel } from "../../src/recovery/refund.model.js";
import { refundRepo } from "../../src/recovery/refund.repo.js";
import { refundDigest } from "../../src/recovery/refund.plan.js";

const id = (digit: string) => `0x${digit.repeat(64)}`;
const address = (digit: string) => `0x${digit.repeat(40)}`;
const base = {
  operationId: id("1"), creditId: id("2"), refundTxHash: id("3"), sourceChain: 1,
  recoveryVault: address("4"), asset: address("5"), amount: "40", nonce: "1",
  deadline: Math.floor(Date.now() / 1000) - 600, refundDigest: "", riskSigner: address("6"),
};
base.refundDigest = refundDigest(base);

afterEach(() => vi.restoreAllMocks());

describe("source refund persistence", () => {
  it("never binds one source transaction to a different operation", async () => {
    vi.spyOn(RecoveryRefundModel, "updateOne").mockResolvedValue({} as never);
    vi.spyOn(RecoveryRefundModel, "findOne").mockReturnValue({
      lean: async () => ({ ...base, operationId: id("7") }),
    } as never);
    await expect(refundRepo.open(base)).rejects.toThrow("recovery-refund-conflict");
  });

  it("rotates an expired digest and clears its signature without changing refund identity", async () => {
    const previous = { ...base, riskSignature: "0xsignature", state: "pending" };
    const nextDeadline = Math.floor(Date.now() / 1000) + 600;
    const update = vi.spyOn(RecoveryRefundModel, "findOneAndUpdate")
      .mockReturnValue({ lean: async () => ({ ...previous, nonce: "2", deadline: nextDeadline }) } as never);
    await refundRepo.renew(previous, nextDeadline);
    const [filter, mutation] = update.mock.calls[0]!;
    expect(filter).toMatchObject({ refundTxHash: previous.refundTxHash, nonce: "1", deadline: previous.deadline });
    expect(mutation).toMatchObject({
      $set: { nonce: "2", deadline: nextDeadline },
      $unset: { riskSignature: "", txHash: "", rawTx: "" },
      $push: { priorAttempts: { nonce: "1", refundDigest: previous.refundDigest } },
    });
    expect(mutation.$set.refundDigest).not.toBe(previous.refundDigest);
  });
});
