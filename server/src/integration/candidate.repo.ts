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
  async setProposal(id: string, owner: string, proposal: unknown) {
    return CandidateModel.findOneAndUpdate({ id, owner, status: "ready_to_test" },
      { $set: { proposal, status: "security_review" } }, { new: true }).lean();
  },
  async activate(id: string, reviewer: string, session?: ClientSession) {
    return CandidateModel.findOneAndUpdate({ id, status: "security_review" },
      { $set: { status: "active", reviewer, reviewedAt: new Date() } }, { new: true, session }).lean();
  },
};
