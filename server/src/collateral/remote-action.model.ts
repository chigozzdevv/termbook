import mongoose from "mongoose";

const remoteActionSchema = new mongoose.Schema({
  actionHash: { type: String, required: true, unique: true },
  creditId: { type: String, required: true, index: true },
  kind: { type: Number, required: true, enum: [0, 1, 2] },
  authorizationTxHash: { type: String, required: true },
  action: { type: mongoose.Schema.Types.Mixed, required: true },
  state: { type: String, required: true, default: "pending" },
  txHash: String,
  rawTx: String,
  sourceNonce: Number,
  sourceBlockHash: String,
  confirmTxHash: String,
  confirmRawTx: String,
  confirmNonce: Number,
  confirmBlockHash: String,
  failure: String,
  nextRunAt: Date,
  failures: { type: Number, default: 0 },
}, { timestamps: true });
remoteActionSchema.index({ state: 1, nextRunAt: 1, createdAt: 1 });

const signerSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  actionHash: String,
}, { timestamps: true });

export const RemoteActionModel = mongoose.models["RemoteAction"]
  ?? mongoose.model("RemoteAction", remoteActionSchema);

export const RemoteActionSignerModel = mongoose.models["RemoteActionSigner"]
  ?? mongoose.model("RemoteActionSigner", signerSchema);
