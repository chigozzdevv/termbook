import mongoose from "mongoose";

const intentSchema = new mongoose.Schema(
  {
    intentId: { type: String, required: true, unique: true },
    bundleId: String,
    settlementAsset: { type: String, required: true },
    borrower: String,
    chainId: Number,
    asset: String,
    amount: String,
    owner: String,
    recipient: String,
    collateral: mongoose.Schema.Types.Mixed,
    duration: Number,
    limit: String,
    actionFunding: String,
    action: mongoose.Schema.Types.Mixed,
    expiresAt: Number,
    status: { type: String, enum: ["open", "used", "expired"], default: "open" },
    used: { type: Boolean, default: false },
  },
  { timestamps: true },
);

intentSchema.index({ settlementAsset: 1, status: 1, used: 1, expiresAt: 1, createdAt: -1, _id: -1 });

export const IntentModel = mongoose.models["Intent"] ?? mongoose.model("Intent", intentSchema);
