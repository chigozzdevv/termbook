import mongoose from "mongoose";

const candidateSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  applicationId: { type: String, required: true },
  owner: { type: String, required: true },
  status: { type: String, required: true, enum: ["mapping", "ready_to_test", "validating", "security_review", "active"] },
  draft: { type: mongoose.Schema.Types.Mixed, required: true },
  mapping: mongoose.Schema.Types.Mixed,
  proposal: mongoose.Schema.Types.Mixed,
  validationLease: String,
  validationUntil: Date,
  validationError: String,
  reviewer: String,
  reviewedAt: Date,
}, { timestamps: true });

export const CandidateModel = mongoose.models["IntegrationCandidate"]
  ?? mongoose.model("IntegrationCandidate", candidateSchema);
