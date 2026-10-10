import { randomUUID } from "node:crypto";
import { RecoveryFunderModel, RecoveryModel, RecoveryRiskApprovalModel } from "./recovery.model.js";

export type RecoveryFundingRecord = {
  operationId: string;
  creditId: string;
  nonce: string;
  sourceChain: number;
  recoveryVault: string;
  inbox: string;
  depositAddress: string;
  amount: string;
  quoteHash: string;
  deadline: number;
};

export type RecoveryFundingClaim = {
  token: string;
  state: string;
  fundingTxHash?: string;
  fundingRawTx?: string;
  fundingNonce?: number;
  fundingFunder?: string;
};

export type RecoveryRiskApprovalRecord = {
  _id: string;
  creditId: string;
  fundingDigest: string;
  riskSigner: string;
  signature: string;
  deadline: number;
};

const identityKeys = ["creditId", "nonce", "sourceChain", "recoveryVault", "inbox", "depositAddress", "amount", "quoteHash", "deadline"] as const;

export const recoveryRepo = {
  async approveRisk(doc: RecoveryRiskApprovalRecord) {
    try {
      await RecoveryRiskApprovalModel.updateOne(
        { _id: doc._id }, { $setOnInsert: doc }, { upsert: true },
      );
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 11000)) throw error;
    }
    const saved = await RecoveryRiskApprovalModel.findById(doc._id).lean();
    if (!saved || Object.keys(doc).some((key) => String(saved[key]).toLowerCase() !== String(doc[key as keyof RecoveryRiskApprovalRecord]).toLowerCase())) {
      throw new Error("recovery-risk-approval-conflict");
    }
    return saved;
  },
  async riskApproval(operationId: string) {
    return RecoveryRiskApprovalModel.findById(operationId).lean();
  },
  async list(creditId: string) {
    const [approvals, fundings] = await Promise.all([
      RecoveryRiskApprovalModel.find({ creditId }).lean(),
      RecoveryModel.find({ creditId }).lean(),
    ]);
    return [
      ...approvals.map((approval) => ({
        operationId: approval._id,
        creditId: approval.creditId,
        fundingDigest: approval.fundingDigest,
        riskSigner: approval.riskSigner,
        deadline: approval.deadline,
        kind: "risk_approval",
        state: "approved",
        createdAt: approval.createdAt,
        updatedAt: approval.updatedAt,
      })),
      ...fundings.map((funding) => ({ ...funding, kind: "funding" })),
    ];
  },
  async claim(record: RecoveryFundingRecord): Promise<RecoveryFundingClaim | null> {
    try {
      await RecoveryModel.updateOne({ operationId: record.operationId }, { $setOnInsert: { ...record, state: "pending" } }, { upsert: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 11000)) throw error;
    }
    const stored = await RecoveryModel.findOne({ operationId: record.operationId }).lean();
    if (!stored || identityKeys.some((key) => String(stored[key]).toLowerCase() !== String(record[key]).toLowerCase())) {
      throw new Error("recovery-operation-conflict");
    }
    const token = randomUUID();
    const claimed = await RecoveryModel.findOneAndUpdate(
      {
        operationId: record.operationId,
        state: { $in: ["pending", "prepared", "submitted", "submitting"] },
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: Date.now() } }],
      },
      { $set: { leaseToken: token, leaseUntil: Date.now() + 120_000 } },
      { returnDocument: "after" },
    ).lean();
    return claimed ? {
      token, state: claimed.state as string,
      fundingTxHash: claimed.fundingTxHash as string | undefined,
      fundingRawTx: claimed.fundingRawTx as string | undefined,
      fundingNonce: claimed.fundingNonce as number | undefined,
      fundingFunder: claimed.fundingFunder as string | undefined,
    } : null;
  },
  async update(operationId: string, token: string, state: string, fields: Record<string, unknown> = {}): Promise<void> {
    const updated = await RecoveryModel.updateOne(
      { operationId, leaseToken: token },
      { $set: { ...fields, state }, $unset: { leaseToken: "", leaseUntil: "" } },
    );
    if (updated.matchedCount !== 1) throw new Error("recovery-lease-lost");
  },
  async get(operationId: string) {
    return RecoveryModel.findOne({ operationId }).lean();
  },
  async prepareSubmission(
    operationId: string, token: string, funder: string,
    hash: string, rawTx: string, nonce: number,
  ) {
    return RecoveryModel.updateOne(
      { operationId, leaseToken: token, state: "pending", fundingTxHash: { $exists: false } },
      { $set: { fundingTxHash: hash, fundingRawTx: rawTx, fundingNonce: nonce, fundingFunder: funder, state: "prepared" } },
    );
  },
  async markSubmitted(operationId: string, token: string) {
    return RecoveryModel.updateOne(
      { operationId, leaseToken: token, state: "prepared" },
      { $set: { state: "submitted" } },
    );
  },
  async release(operationId: string, token: string): Promise<void> {
    await RecoveryModel.updateOne(
      { operationId, leaseToken: token },
      { $unset: { leaseToken: "", leaseUntil: "" } },
    );
  },
  async acquireFunder(sourceChain: number, funder: string, operationId: string): Promise<boolean> {
    const key = `${sourceChain}:${funder.toLowerCase()}`;
    try {
      await RecoveryFunderModel.updateOne({ _id: key }, { $setOnInsert: { _id: key } }, { upsert: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 11000)) throw error;
    }
    const claimed = await RecoveryFunderModel.findOneAndUpdate(
      { _id: key, $or: [{ operationId: { $exists: false } }, { operationId }] },
      { $set: { operationId } },
      { returnDocument: "after" },
    ).lean();
    return Boolean(claimed);
  },
  async releaseFunder(sourceChain: number, funder: string, operationId: string): Promise<void> {
    const key = `${sourceChain}:${funder.toLowerCase()}`;
    await RecoveryFunderModel.updateOne({ _id: key, operationId }, { $unset: { operationId: "" } });
  },
};
