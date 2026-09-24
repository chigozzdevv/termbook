import mongoose from "mongoose";

const integrationSchema = new mongoose.Schema(
  {
    versionId: { type: String, required: true, unique: true },
    codeHash: String,
    settlementAsset: { type: String, required: true },
    actions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    acceptance: { type: mongoose.Schema.Types.Mixed, required: true },
    accepted: { type: Boolean, default: false },
    tokenHash: { type: String, unique: true, sparse: true },
    active: { type: Boolean, default: true },
    frozen: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const IntegrationModel =
  mongoose.models["Integration"] ?? mongoose.model("Integration", integrationSchema);
