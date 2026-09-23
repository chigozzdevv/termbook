import mongoose from "mongoose";

const refundSchema = new mongoose.Schema({
  refundTxHash: { type: String, required: true, unique: true },
  operationId: { type: String, required: true, index: true },
  creditId: { type: String, required: true, index: true },
  sourceChain: { type: Number, required: true },
  recoveryVault: { type: String, required: true },
  asset: { type: String, required: true },
  amount: { type: String, required: true },
  nonce: { type: String, required: true },
  deadline: { type: Number, required: true },
  refundDigest: { type: String, required: true },
  riskSigner: { type: String, required: true },
  riskSignature: String,
  state: { type: String, required: true, default: "pending" },
  txHash: String,
  rawTx: String,
  sourceNonce: Number,
  sourceBlockHash: String,
  priorAttempts: [{
    nonce: String, deadline: Number, refundDigest: String, txHash: String,
    sourceNonce: Number, gasPrice: String, maxFeePerGas: String, maxPriorityFeePerGas: String,
  }],
  leaseToken: String,
  leaseUntil: Number,
  failure: String,
}, { timestamps: true });

export const RecoveryRefundModel = mongoose.models["RecoveryRefund"]
  ?? mongoose.model("RecoveryRefund", refundSchema);
