import mongoose from "mongoose";

const manifest = new mongoose.Schema({
  _id: String, scope: String, generation: String, block: String, updatedAt: String,
  publishedAt: Date, orderCount: Number, houseCount: Number, version: String, eventRevision: String, complete: Boolean,
  lease: String, leaseExpiresAt: Date,
});
manifest.index({ scope: 1, publishedAt: 1 });
const record = new mongoose.Schema({
  _id: String, scope: String, generation: String, kind: String, id: String, intentId: String,
  data: mongoose.Schema.Types.Mixed,
});
record.index({ scope: 1, generation: 1, kind: 1, id: 1 }, { unique: true });
record.index({ scope: 1, generation: 1, intentId: 1 });
export const ExplorerManifestModel = mongoose.models["ExplorerManifest"] ?? mongoose.model("ExplorerManifest", manifest);
export const ExplorerRecordModel = mongoose.models["ExplorerRecord"] ?? mongoose.model("ExplorerRecord", record);
