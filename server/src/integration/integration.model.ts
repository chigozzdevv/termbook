import mongoose from "mongoose";

const integrationSchema = new mongoose.Schema(
  {
    versionId: { type: String, required: true, unique: true },
    codeHash: String,
    active: { type: Boolean, default: true },
    frozen: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const IntegrationModel =
  mongoose.models["Integration"] ?? mongoose.model("Integration", integrationSchema);
