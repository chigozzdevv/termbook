import { SolanaLockModel, SolanaProofSignerModel } from "./solana.model.js";
import { randomUUID } from "node:crypto";

export type SolanaLockRecord = { lockId: string; creditId: string; lockPda: string };

export const solanaRepo = {
  async track(record: SolanaLockRecord) {
    const saved = await SolanaLockModel.findOneAndUpdate(
      { lockId: record.lockId }, { $setOnInsert: { ...record, state: "pending" } },
      { upsert: true, new: true },
    ).lean();
    if (!saved || saved.creditId !== record.creditId || saved.lockPda !== record.lockPda) {
      throw new Error("solana-lock-conflict");
    }
    return saved;
  },
  async find(lockId: string) {
    return SolanaLockModel.findOne({ lockId }).lean();
  },
  async list(creditId: string) {
    return SolanaLockModel.find({ creditId }).select("lockId creditId lockPda state txHash failure").lean();
  },
  async pending() {
    return SolanaLockModel.find({ state: { $in: ["pending", "proof_submitted", "proof_mined"] } })
      .sort({ createdAt: 1 }).limit(10).lean();
  },
  async claim(lockId: string): Promise<string | null> {
    const token = randomUUID();
    const claimed = await SolanaLockModel.findOneAndUpdate({
      lockId, state: { $in: ["pending", "proof_submitted", "proof_mined"] },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: Date.now() } }],
    }, { $set: { leaseToken: token, leaseUntil: Date.now() + 1_200_000 } }, { new: true }).lean();
    return claimed ? token : null;
  },
  async releaseClaim(lockId: string, token: string): Promise<void> {
    await SolanaLockModel.updateOne({ lockId, leaseToken: token },
      { $unset: { leaseToken: "", leaseUntil: "" } });
  },
  async setPrepared(lockId: string, proof: object, txHash: string, rawTx: string) {
    return SolanaLockModel.updateOne({ lockId, txHash: { $exists: false }, state: "pending" },
      { $set: { state: "proof_submitted", proof, txHash, rawTx } });
  },
  async setMined(lockId: string, txHash: string) {
    return SolanaLockModel.updateOne({ lockId, txHash, state: { $in: ["proof_submitted", "proof_mined"] } },
      { $set: { state: "proof_mined" } });
  },
  async setProven(lockId: string, txHash?: string) {
    return SolanaLockModel.updateOne(txHash ? { lockId, txHash } : { lockId, txHash: { $exists: false } },
      { $set: { state: "proven" }, $unset: { rawTx: 1 } });
  },
  async setReview(lockId: string, txHash: string, failure: string) {
    return SolanaLockModel.updateOne({ lockId, txHash }, { $set: { state: "manual_review", failure } });
  },
  async clearReverted(lockId: string, txHash: string) {
    return SolanaLockModel.updateOne({ lockId, txHash },
      { $set: { state: "pending" }, $unset: { txHash: 1, rawTx: 1, proof: 1 } });
  },
  async acquireSigner(chainId: number, signer: string, lockId: string): Promise<boolean> {
    const id = `${chainId}:${signer.toLowerCase()}`;
    try {
      await SolanaProofSignerModel.updateOne({ _id: id }, { $setOnInsert: { _id: id } }, { upsert: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 11000)) throw error;
    }
    const claimed = await SolanaProofSignerModel.findOneAndUpdate({
      _id: id, $or: [{ lockId: { $exists: false } }, { lockId }],
    }, { $set: { lockId } }, { new: true }).lean();
    return Boolean(claimed);
  },
  async releaseSigner(chainId: number, signer: string, lockId: string): Promise<void> {
    await SolanaProofSignerModel.updateOne({ _id: `${chainId}:${signer.toLowerCase()}`, lockId },
      { $unset: { lockId: "" } });
  },
};
