import { IntegrationModel } from "./integration.model.js";

export const integrationRepo = {
  async create(doc: Record<string, unknown>) {
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
