import { IntegrationModel } from "./integration.model.js";

export const integrationRepo = {
  async upsert(doc: Record<string, unknown>) {
    return IntegrationModel.findOneAndUpdate({ versionId: doc["versionId"] }, doc, {
      upsert: true,
      new: true,
    }).lean();
  },
  async list() {
    return IntegrationModel.find({ active: true }).lean();
  },
};
