import { IntentModel } from "./intent.model.js";

export const intentRepo = {
  async create(doc: Record<string, unknown>) {
    return IntentModel.create(doc);
  },
  async get(intentId: string) {
    return IntentModel.findOne({ intentId }).lean();
  },
  async markUsed(intentId: string) {
    return IntentModel.updateOne({ intentId }, { used: true });
  },
};
