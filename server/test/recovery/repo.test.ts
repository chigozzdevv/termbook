import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoveryModel, RecoveryRiskApprovalModel } from "../../src/recovery/recovery.model.js";
import { recoveryRepo } from "../../src/recovery/recovery.repo.js";

const id = (digit: string) => `0x${digit.repeat(64)}`;
const address = (digit: string) => `0x${digit.repeat(40)}`;

afterEach(() => vi.restoreAllMocks());

describe("recovery persistence", () => {
  it("does not expose the risk signature in recovery status", async () => {
    const approval = {
      _id: id("1"), creditId: id("2"), fundingDigest: id("3"),
      riskSigner: address("4"), signature: `0x${"5".repeat(130)}`, deadline: 400,
    };
    vi.spyOn(RecoveryRiskApprovalModel, "find").mockReturnValue({ lean: async () => [approval] } as never);
    vi.spyOn(RecoveryModel, "find").mockReturnValue({ lean: async () => [] } as never);

    const status = await recoveryRepo.list(approval.creditId);
    expect(status).toMatchObject([{ operationId: approval._id, fundingDigest: approval.fundingDigest, state: "approved" }]);
    expect(status[0]).not.toHaveProperty("signature");
  });

  it("keeps external risk approval separate from the worker funding lease", async () => {
    const approval = {
      _id: id("1"), creditId: id("2"), fundingDigest: id("3"),
      riskSigner: address("4"), signature: `0x${"5".repeat(130)}`, deadline: 400,
    };
    const funding = {
      operationId: approval._id, creditId: approval.creditId,
      nonce: "1", sourceChain: 1, recoveryVault: address("6"),
      inbox: address("a"), depositAddress: address("b"), amount: "300",
      quoteHash: id("7"), deadline: 400,
    };
    expect(new RecoveryRiskApprovalModel(approval).toObject()).toMatchObject(approval);
    expect(new RecoveryModel(funding).toObject()).toMatchObject(funding);

    const approvalUpdate = vi.spyOn(RecoveryRiskApprovalModel, "updateOne").mockResolvedValue({} as never);
    vi.spyOn(RecoveryRiskApprovalModel, "findById").mockReturnValue({ lean: async () => approval } as never);
    const fundingUpdate = vi.spyOn(RecoveryModel, "updateOne").mockResolvedValue({} as never);
    vi.spyOn(RecoveryModel, "findOne").mockReturnValue({ lean: async () => funding } as never);
    vi.spyOn(RecoveryModel, "findOneAndUpdate").mockReturnValue({
      lean: async () => ({ ...funding, state: "pending" }),
    } as never);

    expect(await recoveryRepo.approveRisk(approval)).toMatchObject(approval);
    const claim = await recoveryRepo.claim(funding);
    expect(claim).toMatchObject({ state: "pending" });
    expect(claim?.token).toEqual(expect.any(String));
    expect(approvalUpdate).toHaveBeenCalledWith(
      { _id: approval._id }, { $setOnInsert: approval }, { upsert: true },
    );
    expect(fundingUpdate).toHaveBeenCalledWith(
      { operationId: funding.operationId },
      { $setOnInsert: { ...funding, state: "pending" } },
      { upsert: true },
    );
  });
});
