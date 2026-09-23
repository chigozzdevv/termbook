import mongoose from "mongoose";

const lockSchema = new mongoose.Schema({
  lockId: { type: String, required: true, unique: true },
  creditId: { type: String, required: true },
  lockPda: { type: String, required: true },
  state: { type: String, default: "pending" },
  proof: mongoose.Schema.Types.Mixed,
  txHash: String,
  rawTx: String,
  failure: String,
  leaseToken: String,
  leaseUntil: Number,
}, { timestamps: true });

export const SolanaLockModel = mongoose.models["SolanaLock"]
  ?? mongoose.model("SolanaLock", lockSchema);

const signerSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  lockId: String,
}, { timestamps: true });

export const SolanaProofSignerModel = mongoose.models["SolanaProofSigner"]
  ?? mongoose.model("SolanaProofSigner", signerSchema);
