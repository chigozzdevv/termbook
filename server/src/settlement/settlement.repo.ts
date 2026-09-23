import { SettlementModel } from "./settlement.model.js";
import { randomUUID } from "node:crypto";
import { HttpError } from "../http/http.errors.js";

const identityKeys = ["kind", "payer", "nonce", "sourceChain", "sourceAsset", "vault", "token", "creditId", "maxAmountIn", "maxReceived", "minAmountOut", "deadline", "refundRecipient", "sourceRefundRecipient", "monadRefundRecipient", "routeId", "routeVersion", "lpRecipient", "minShares", "inbox", "registrationTxHash"];

function assertSame(existing: Record<string, unknown>, doc: Record<string, unknown>): void {
  for (const key of identityKeys) {
    if (doc[key] !== undefined && String(doc[key]) !== String(existing[key])) {
      throw new HttpError(409, "settlement-operation-conflict");
    }
  }
}

export const settlementRepo = {
  async save(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    let existing = await SettlementModel.findOne({ operationId: doc["operationId"] }).lean();
    if (existing) {
      assertSame(existing, doc);
      return existing;
    }
    try {
      const created = await SettlementModel.create(doc);
      return created.toObject();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 11000)) throw error;
      existing = await SettlementModel.findOne({ operationId: doc["operationId"] }).lean();
      if (!existing) throw error;
      assertSame(existing, doc);
      return existing;
    }
  },
  async claimQuote(operationId: string): Promise<string | null> {
    const token = randomUUID();
    const now = Date.now();
    const claimed = await SettlementModel.findOneAndUpdate(
      { operationId, quote: { $exists: false }, $or: [{ quoteLeaseUntil: { $exists: false } }, { quoteLeaseUntil: { $lt: now } }] },
      { $set: { quoteLeaseToken: token, quoteLeaseUntil: now + 30_000 } },
      { new: true },
    ).lean();
    return claimed ? token : null;
  },
  async finishQuote(operationId: string, token: string, quote: unknown): Promise<Record<string, unknown>> {
    const saved = await SettlementModel.findOneAndUpdate(
      { operationId, quoteLeaseToken: token },
      { $set: { quote }, $unset: { quoteLeaseToken: "", quoteLeaseUntil: "" } },
      { new: true },
    ).lean();
    if (!saved) throw new Error("settlement-quote-conflict");
    return saved;
  },
  async releaseQuote(operationId: string, token: string): Promise<void> {
    await SettlementModel.updateOne(
      { operationId, quoteLeaseToken: token },
      { $unset: { quoteLeaseToken: "", quoteLeaseUntil: "" } },
    );
  },
  async get(operationId: string) {
    return SettlementModel.findOne({ operationId }).lean();
  },
};
