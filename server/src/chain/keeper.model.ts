import mongoose from "mongoose";

const wallet = new mongoose.Schema({
  _id: String,
  lease: String,
  leaseExpiresAt: Date,
  pending: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
const transaction = new mongoose.Schema({
  _id: String,
  hash: String,
  status: { type: String, enum: ["success", "reverted"], required: true },
  block: String,
  blockHash: String,
  nonce: Number,
}, { timestamps: true });
export const KeeperWalletModel = mongoose.models["TermbookKeeperWallet"]
  ?? mongoose.model("TermbookKeeperWallet", wallet);
export const KeeperTransactionModel = mongoose.models["TermbookKeeperTransaction"]
  ?? mongoose.model("TermbookKeeperTransaction", transaction);
