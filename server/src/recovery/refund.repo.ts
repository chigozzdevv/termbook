import { randomUUID } from "node:crypto";
import { parseTransaction, type Hex } from "viem";
import { RecoveryRefundModel } from "./refund.model.js";
import { refundDigest, type RefundRecord } from "./refund.plan.js";

const identity = [
  "operationId", "creditId", "refundTxHash", "sourceChain", "recoveryVault", "asset",
  "amount", "riskSigner",
] as const;

const same = (left: unknown, right: unknown): boolean => String(left).toLowerCase() === String(right).toLowerCase();

export const refundRepo = {
  async open(record: RefundRecord) {
    try {
      await RecoveryRefundModel.updateOne({ refundTxHash: record.refundTxHash }, {
        $setOnInsert: { ...record, state: "pending" },
      }, { upsert: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 11000)) throw error;
    }
    const saved = await RecoveryRefundModel.findOne({ refundTxHash: record.refundTxHash }).lean();
    if (!saved || identity.some((key) => !same(saved[key], record[key]))) {
      throw new Error("recovery-refund-conflict");
    }
    return saved;
  },
  async get(refundTxHash: string) {
    return RecoveryRefundModel.findOne({ refundTxHash }).lean();
  },
  async approve(refundTxHash: string, digest: string, signature: string) {
    const updated = await RecoveryRefundModel.findOneAndUpdate({
      refundTxHash, refundDigest: digest, state: "pending", riskSignature: { $exists: false },
    }, { $set: { riskSignature: signature } }, { new: true }).lean();
    if (updated) return updated;
    const saved = await this.get(refundTxHash);
    if (!saved || !same(saved.refundDigest, digest) || !same(saved.riskSignature, signature)) {
      throw new Error("recovery-refund-approval-conflict");
    }
    return saved;
  },
  async renew(previous: RefundRecord, deadline: number) {
    if (deadline <= previous.deadline || previous.deadline >= Math.floor(Date.now() / 1000)) {
      throw new Error("recovery-refund-renew-too-early");
    }
    const nonce = (BigInt(previous.nonce) + 1n).toString();
    const next: RefundRecord = { ...previous, nonce, deadline, riskSignature: undefined,
      txHash: undefined, rawTx: undefined };
    const digest = refundDigest(next);
    const priorTx = previous.rawTx ? parseTransaction(previous.rawTx as Hex) : null;
    if (priorTx && priorTx.nonce !== previous.sourceNonce) throw new Error("recovery-refund-nonce-mismatch");
    const updated = await RecoveryRefundModel.findOneAndUpdate({
      refundTxHash: previous.refundTxHash, nonce: previous.nonce,
      deadline: previous.deadline, refundDigest: previous.refundDigest,
      state: { $in: ["pending", "prepared", "submitted", "mined", "manual_review"] },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: Date.now() } }],
    }, {
      $set: { nonce, deadline, refundDigest: digest, state: "pending" },
      $unset: { riskSignature: "", txHash: "", rawTx: "", sourceNonce: "", sourceBlockHash: "", failure: "" },
      $push: { priorAttempts: { nonce: previous.nonce, deadline: previous.deadline,
        refundDigest: previous.refundDigest, txHash: previous.txHash, sourceNonce: previous.sourceNonce,
        gasPrice: priorTx?.gasPrice?.toString(), maxFeePerGas: priorTx?.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: priorTx?.maxPriorityFeePerGas?.toString() } },
    }, { new: true }).lean();
    if (updated) return updated;
    const saved = await this.get(previous.refundTxHash);
    if (!saved || identity.some((key) => !same(saved[key], previous[key]))) throw new Error("recovery-refund-renew-conflict");
    return saved;
  },
  async list(creditId: string) {
    const records = await RecoveryRefundModel.find({ creditId }).sort({ createdAt: -1 }).lean();
    return records.map((record) => {
      const visible: Record<string, unknown> = { ...record };
      delete visible["rawTx"];
      delete visible["riskSignature"];
      delete visible["leaseToken"];
      return visible;
    });
  },
  async listPending() {
    return RecoveryRefundModel.find({ riskSignature: { $exists: true }, state: { $in: ["pending", "prepared", "submitted", "mined"] } })
      .sort({ updatedAt: 1 }).limit(25).lean();
  },
  async claim(refundTxHash: string) {
    const token = randomUUID();
    const saved = await RecoveryRefundModel.findOneAndUpdate({
      refundTxHash, riskSignature: { $exists: true },
      state: { $in: ["pending", "prepared", "submitted", "mined"] },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: Date.now() } }],
    }, { $set: { leaseToken: token, leaseUntil: Date.now() + 120_000 } }, { new: true }).lean();
    return saved ? { token, record: saved } : null;
  },
  async prepare(refundTxHash: string, token: string, txHash: string, rawTx: string, sourceNonce: number) {
    const updated = await RecoveryRefundModel.updateOne({ refundTxHash, leaseToken: token, state: "pending", txHash: { $exists: false } }, {
      $set: { state: "prepared", txHash, rawTx, sourceNonce },
    });
    if (updated.matchedCount !== 1) throw new Error("recovery-refund-prepare-conflict");
  },
  async state(refundTxHash: string, token: string, state: string, fields: Record<string, unknown> = {}) {
    const updated = await RecoveryRefundModel.updateOne({ refundTxHash, leaseToken: token }, {
      $set: { state, ...fields },
      ...(state === "confirmed" ? { $unset: { rawTx: "" } } : {}),
    });
    if (updated.matchedCount !== 1) throw new Error("recovery-refund-lease-lost");
  },
  async release(refundTxHash: string, token: string) {
    await RecoveryRefundModel.updateOne({ refundTxHash, leaseToken: token }, {
      $unset: { leaseToken: "", leaseUntil: "" },
    });
  },
};
