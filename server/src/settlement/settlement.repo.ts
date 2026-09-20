import { SettlementModel } from "./settlement.model.js";

export const settlementRepo = {
  async save(doc: Record<string, unknown>) {
    const existing = await SettlementModel.findOne({ operationId: doc["operationId"] }).lean();
    if (existing) {
      for (const key of ["kind", "payer", "nonce", "sourceChain", "sourceAsset", "vault", "token", "creditId", "maxAmountIn", "minAmountOut", "deadline", "refundRecipient", "sourceRefundRecipient", "monadRefundRecipient", "routeVersion"]) {
        if (doc[key] !== undefined && existing[key] !== undefined && String(doc[key]) !== String(existing[key])) throw new Error("settlement-operation-conflict");
      }
      return existing;
    }
    return SettlementModel.create(doc);
  },
  async get(operationId: string) {
    return SettlementModel.findOne({ operationId }).lean();
  },
};
