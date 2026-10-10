import { CollateralModel, CollateralSignerModel } from "./collateral.model.js";

export const collateralRepo = {
  async save(doc: Record<string, unknown>) {
    const saved = await CollateralModel.findOneAndUpdate({ lockId: doc["lockId"] }, { $setOnInsert: doc }, {
      upsert: true,
      returnDocument: "after",
    }).lean();
    if (saved && (saved.creditId !== doc["creditId"] || saved.owner?.toLowerCase() !== String(doc["owner"]).toLowerCase()
      || saved.amount !== doc["amount"])) throw new Error("collateral-track-conflict");
    return saved;
  },
  async find(lockId: string) {
    return CollateralModel.findOne({ lockId }).lean();
  },
  async listByCredit(creditId: string) {
    return CollateralModel.find({ creditId }).select("lockId creditId amount owner state txHash").lean();
  },
  async listPending() {
    return CollateralModel.find({ state: { $in: ["pending", "proof_fetched", "proof_retrying", "proof_submitted", "proof_mined"] } })
      .sort({ createdAt: 1 }).limit(10).lean();
  },
  async setState(lockId: string, state: string, proof?: object) {
    return CollateralModel.updateOne(state === "proof_fetched"
      ? { lockId, txHash: { $exists: false }, state: { $ne: "proven" } }
      : { lockId }, {
      $set: { state, ...(proof ? { proof } : {}) },
      ...(state === "proven" ? { $unset: { rawTx: 1 } } : {}),
    });
  },
  async setPrepared(lockId: string, proof: object, txHash: string, rawTx: string) {
    return CollateralModel.updateOne({
      lockId, txHash: { $exists: false }, state: { $in: ["pending", "proof_fetched", "proof_retrying"] },
    }, {
      $set: { state: "proof_submitted", proof, txHash, rawTx },
    });
  },
  async clearReverted(lockId: string, txHash: string) {
    return CollateralModel.updateOne({ lockId, txHash, state: { $in: ["proof_submitted", "proof_mined"] } }, {
      $set: { state: "proof_retrying" }, $unset: { txHash: 1, rawTx: 1 },
    });
  },
  async setMined(lockId: string, txHash: string) {
    return CollateralModel.updateOne({ lockId, txHash, state: { $in: ["proof_submitted", "proof_mined"] } }, {
      $set: { state: "proof_mined" },
    });
  },
  async setProvenWithoutTx(lockId: string) {
    return CollateralModel.updateOne({ lockId, txHash: { $exists: false } }, {
      $set: { state: "proven" }, $unset: { rawTx: 1 },
    });
  },
  async setProvenFromTx(lockId: string, txHash: string) {
    return CollateralModel.updateOne({ lockId, txHash, state: { $in: ["proof_submitted", "proof_mined"] } }, {
      $set: { state: "proven" }, $unset: { rawTx: 1 },
    });
  },
  async setReview(lockId: string, txHash: string, failure: string) {
    return CollateralModel.updateOne({ lockId, txHash, state: { $in: ["proof_submitted", "proof_mined"] } }, {
      $set: { state: "manual_review", failure },
    });
  },
  async acquireSigner(chainId: number, signer: string, lockId: string): Promise<boolean> {
    const key = `${chainId}:${signer.toLowerCase()}`;
    try {
      await CollateralSignerModel.updateOne({ _id: key }, { $setOnInsert: { _id: key } }, { upsert: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 11000)) throw error;
    }
    const claimed = await CollateralSignerModel.findOneAndUpdate({
      _id: key, $or: [{ lockId: { $exists: false } }, { lockId }],
    }, { $set: { lockId } }, { returnDocument: "after" }).lean();
    return Boolean(claimed);
  },
  async releaseSigner(chainId: number, signer: string, lockId: string): Promise<void> {
    await CollateralSignerModel.updateOne({ _id: `${chainId}:${signer.toLowerCase()}`, lockId }, {
      $unset: { lockId: "" },
    });
  },
};
