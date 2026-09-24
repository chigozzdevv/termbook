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
  async list(borrower: string) {
    return CreditModel.find({ borrower: borrower.toLowerCase() }).select("creditId borrower house bundleId facility").lean();
  },
  async setFacility(creditId: string, facility: string) {
    return CreditModel.updateOne({ creditId }, { facility });
  },
};
