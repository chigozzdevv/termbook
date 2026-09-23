import mongoose from "mongoose";

const recoverySchema = new mongoose.Schema(
  {
    operationId: { type: String, unique: true, sparse: true },
    creditId: { type: String, required: true },
    nonce: String,
    kind: { type: String, enum: ["partial", "full"] },
    state: { type: String, default: "pending" },
    sourceChain: Number,
    recoveryVault: String,
    inbox: String,
    depositAddress: String,
    amount: String,
    quoteHash: String,
    deadline: Number,
    fundingTxHash: String,
    fundingRawTx: String,
    fundingNonce: Number,
    fundingFunder: String,
    sourceBlockHash: String,
    leaseToken: String,
    leaseUntil: Number,
    failure: String,
  },
  { timestamps: true },
);

export const RecoveryModel =
  mongoose.models["Recovery"] ?? mongoose.model("Recovery", recoverySchema);

const funderSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  operationId: String,
}, { timestamps: true });

export const RecoveryFunderModel =
  mongoose.models["RecoveryFunder"] ?? mongoose.model("RecoveryFunder", funderSchema);

const riskApprovalSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  creditId: { type: String, required: true },
  fundingDigest: { type: String, required: true },
  riskSigner: { type: String, required: true },
  signature: { type: String, required: true },
  deadline: { type: Number, required: true },
}, { timestamps: true });

export const RecoveryRiskApprovalModel =
  mongoose.models["RecoveryRiskApproval"] ?? mongoose.model("RecoveryRiskApproval", riskApprovalSchema);
