import { CandidateModel } from "./candidate.model.js";
import type { ClientSession } from "mongoose";

export const candidateRepo = {
  async create(input: { id: string; applicationId: string; owner: string; status: string; draft: unknown }) {
    return CandidateModel.create(input);
  },
  async get(id: string) {
    return CandidateModel.findOne({ id }).lean();
  },
  async setMapping(id: string, owner: string, mapping: unknown) {
    return CandidateModel.findOneAndUpdate({ id, owner, status: "mapping" },
      { $set: { mapping, status: "ready_to_test" } }, { new: true }).lean();
  },
  async beginValidation(id: string, owner: string, proposal: unknown, lease: string) {
    return CandidateModel.findOneAndUpdate({ id, owner, $or: [{ status: "ready_to_test" },
      { status: "validating", validationUntil: { $lte: new Date() } }] },
    { $set: { proposal, status: "validating", validationLease: lease, validationUntil: new Date(Date.now() + 300_000) },
      $unset: { validationError: 1 } }, { new: true }).lean();
  },
  async renewValidation(id: string, lease: string) {
    return CandidateModel.findOneAndUpdate({ id, status: "validating", validationLease: lease, validationUntil: { $gt: new Date() } },
      { $set: { validationUntil: new Date(Date.now() + 300_000) } }, { new: true }).lean();
  },
  async setProposal(id: string, owner: string, proposal: unknown, lease: string) {
    return CandidateModel.findOneAndUpdate({ id, owner, status: "validating", validationLease: lease, validationUntil: { $gt: new Date() } },
      { $set: { proposal, status: "security_review" }, $unset: { validationLease: 1, validationUntil: 1, validationError: 1 } }, { new: true }).lean();
  },
  async failValidation(id: string, lease: string, code: string) {
    return CandidateModel.updateOne({ id, status: "validating", validationLease: lease },
      { $set: { status: "ready_to_test", validationError: code }, $unset: { validationLease: 1, validationUntil: 1 } });
  },
  async activate(id: string, reviewer: string, session?: ClientSession) {
    return CandidateModel.findOneAndUpdate({ id, status: "security_review" },
      { $set: { status: "active", reviewer, reviewedAt: new Date() } }, { new: true, session }).lean();
  },
};
