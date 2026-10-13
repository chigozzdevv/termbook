import mongoose from "mongoose";

const cursorSchema = new mongoose.Schema({
  _id: String,
  nextBlock: { type: String, required: true },
  lastBlockHash: String,
  indexedAt: Date,
  eventRevision: String,
  lease: String,
  leaseExpiresAt: Date,
  integrityFailure: String,
}, { timestamps: true });
const eventSchema = new mongoose.Schema({
  _id: String,
  chainId: { type: Number, required: true },
  core: { type: String, required: true },
  block: { type: String, required: true },
  blockHash: { type: String, required: true },
  txHash: { type: String, required: true },
  logIndex: { type: Number, required: true },
  event: { type: String, required: true },
  creditId: String,
  data: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
eventSchema.index({ chainId: 1, core: 1, creditId: 1, block: 1 });
export const IndexCursorModel = mongoose.models["TermbookIndexCursor"]
  ?? mongoose.model("TermbookIndexCursor", cursorSchema);
export const CoreEventModel = mongoose.models["TermbookCoreEvent"]
  ?? mongoose.model("TermbookCoreEvent", eventSchema);
