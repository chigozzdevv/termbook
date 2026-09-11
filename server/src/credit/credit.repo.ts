import { CreditModel } from "./credit.model.js";

export const creditRepo = {
  async save(doc: Record<string, unknown>) {
    return CreditModel.findOneAndUpdate({ creditId: doc["creditId"] }, doc, {
      upsert: true,
      new: true,
    }).lean();
  },
  async get(creditId: string) {
    return CreditModel.findOne({ creditId }).lean();
  },
  async setFacility(creditId: string, facility: string) {
    return CreditModel.updateOne({ creditId }, { facility });
  },
};
