import mongoose from "mongoose";

const schema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  applicationId: { type: String, required: true }, owner: { type: String, required: true },
  versionId: { type: String, required: true }, packageHash: { type: String, required: true },
  definition: { type: mongoose.Schema.Types.Mixed, required: true },
  proposal: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ["validated", "awaiting_approval", "active"], required: true },
  expiresAt: { type: Date, required: true }, appToken: String, reviewer: String,
}, { timestamps: true, minimize: false });
schema.index({ applicationId: 1, owner: 1, packageHash: 1 });
export const PackageModel = mongoose.models["IntegrationPackage"] ?? mongoose.model("IntegrationPackage", schema);
