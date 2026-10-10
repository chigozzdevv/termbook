import { afterEach, describe, expect, it, vi } from "vitest";
import { CollateralModel, CollateralSignerModel } from "../../src/collateral/collateral.model.js";
import { collateralRepo } from "../../src/collateral/collateral.repo.js";

afterEach(() => vi.restoreAllMocks());

describe("collateral proof persistence", () => {
  it("compares an absent transaction hash before saving a signed attempt", async () => {
    const update = vi.spyOn(CollateralModel, "updateOne").mockResolvedValue({ matchedCount: 1 } as never);
    await collateralRepo.setPrepared("lock", { header: "0x12" }, "hash", "raw");
    expect(update).toHaveBeenCalledWith(
      { lockId: "lock", txHash: { $exists: false }, state: { $in: ["pending", "proof_fetched", "proof_retrying"] } },
      { $set: { state: "proof_submitted", proof: { header: "0x12" }, txHash: "hash", rawTx: "raw" } },
    );
  });

  it("only clears the reverted transaction that was observed", async () => {
    const update = vi.spyOn(CollateralModel, "updateOne").mockResolvedValue({ matchedCount: 1 } as never);
    await collateralRepo.clearReverted("lock", "old-hash");
    expect(update).toHaveBeenCalledWith(
      { lockId: "lock", txHash: "old-hash", state: { $in: ["proof_submitted", "proof_mined"] } },
      { $set: { state: "proof_retrying" }, $unset: { txHash: 1, rawTx: 1 } },
    );
  });

  it("reserves the keeper across different locks on the same chain", async () => {
    vi.spyOn(CollateralSignerModel, "updateOne").mockResolvedValue({ matchedCount: 1 } as never);
    const claim = vi.spyOn(CollateralSignerModel, "findOneAndUpdate").mockReturnValue({
      lean: async () => null,
    } as never);
    expect(await collateralRepo.acquireSigner(143, "0xAAbb", "lock-b")).toBe(false);
    expect(claim).toHaveBeenCalledWith({
      _id: "143:0xaabb", $or: [{ lockId: { $exists: false } }, { lockId: "lock-b" }],
    }, { $set: { lockId: "lock-b" } }, { returnDocument: "after" });
  });
});
