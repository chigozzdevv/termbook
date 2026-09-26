import mongoose from "mongoose";

const applicationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  origin: { type: String, required: true },
  chainId: { type: Number, required: true },
  owner: { type: String, required: true },
  challenge: { type: String, required: true },
  challengeExpiresAt: { type: Date, required: true },
  verifiedAt: Date,
}, { timestamps: true });

applicationSchema.index({ owner: 1, origin: 1, chainId: 1 }, { unique: true });

export const ApplicationModel = mongoose.models["Application"]
  ?? mongoose.model("Application", applicationSchema);
