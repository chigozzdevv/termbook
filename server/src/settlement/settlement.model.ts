import mongoose from "mongoose";

const settlementSchema = new mongoose.Schema(
  {
    operationId: { type: String, required: true, unique: true },
    kind: String,
    payer: String,
    sourceChain: Number,
    sourceAsset: String,
    vault: String,
    token: String,
    creditId: String,
    maxAmountIn: String,
    minAmountOut: String,
    deadline: Number,
    refundRecipient: String,
    sourceRefundRecipient: String,
    monadRefundRecipient: String,
    routeVersion: String,
    received: { type: String, default: "0" },
    applied: { type: String, default: "0" },
    refunded: { type: String, default: "0" },
  },
  { timestamps: true },
);

export const SettlementModel =
  mongoose.models["Settlement"] ?? mongoose.model("Settlement", settlementSchema);
