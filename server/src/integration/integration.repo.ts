import { IntegrationModel } from "./integration.model.js";
import type { ClientSession } from "mongoose";

export const integrationRepo = {
  async create(doc: Record<string, unknown>, session?: ClientSession) {
    if (session) return IntegrationModel.create([doc], { session });
    return IntegrationModel.create(doc);
  },
  async byTokenHash(tokenHash: string) {
    return IntegrationModel.findOne({ tokenHash }).lean();
  },
  async list() {
    return IntegrationModel.find({ active: true, accepted: true })
      .select("-tokenHash -acceptance").lean();
  },
};
