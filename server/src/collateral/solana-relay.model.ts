import mongoose from "mongoose";

const action = new mongoose.Schema({
  _id: String, creditId: { type: String, required: true }, kind: { type: Number, enum: [0, 1, 2], required: true },
  authorizationTxHash: { type: String, required: true }, state: { type: String, default: "pending" },
  mode: String, sourceTx: String, lease: String, leaseExpiresAt: Date,
  transactionCount: { type: Number, default: 0 }, failures: { type: Number, default: 0 },
  nextRunAt: { type: Date, default: Date.now }, failure: String,
}, { timestamps: true });
action.index({ state: 1, nextRunAt: 1, leaseExpiresAt: 1 });
const transaction = new mongoose.Schema({
  _id: String, actionHash: { type: String, required: true, index: true },
  raw: { type: String, required: true }, blockhash: { type: String, required: true },
  lastValidBlockHeight: { type: Number, required: true }, status: { type: String, default: "prepared" },
  slot: Number,
}, { timestamps: true });
export const SolanaRelayModel = mongoose.models["TermbookSolanaRelay"] ?? mongoose.model("TermbookSolanaRelay", action);
export const SolanaRelayTransactionModel = mongoose.models["TermbookSolanaRelayTransaction"]
  ?? mongoose.model("TermbookSolanaRelayTransaction", transaction);
