import mongoose from "mongoose";

const integrationSchema = new mongoose.Schema(
  {
    applicationId: { type: String, required: true },
    applicationOwner: { type: String, required: true },
    applicationOrigin: { type: String, required: true },
    category: { type: String, required: true },
    versionId: { type: String, required: true, unique: true },
    codeHash: String,
    settlementAsset: { type: String, required: true },
    actions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    sourcePins: { type: [mongoose.Schema.Types.Mixed], default: [] },
    acceptance: { type: mongoose.Schema.Types.Mixed, required: true },
    accepted: { type: Boolean, default: false },
    review: mongoose.Schema.Types.Mixed,
    packageDefinition: mongoose.Schema.Types.Mixed,
    tokenHash: { type: String, unique: true, sparse: true },
    active: { type: Boolean, default: true },
    frozen: { type: Boolean, default: false },
  },
  { timestamps: true, minimize: false },
);

export const IntegrationModel =
  mongoose.models["Integration"] ?? mongoose.model("Integration", integrationSchema);
