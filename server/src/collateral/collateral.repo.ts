import { CollateralModel } from "./collateral.model.js";

export const collateralRepo = {
  async save(doc: Record<string, unknown>) {
    return CollateralModel.findOneAndUpdate({ lockId: doc["lockId"] }, doc, {
      upsert: true,
      new: true,
    }).lean();
  },
  async listByCredit(creditId: string) {
    return CollateralModel.find({ creditId }).lean();
  },
  async setState(lockId: string, state: string, proof?: Record<string, unknown>) {
    return CollateralModel.updateOne({ lockId }, { $set: { state, ...(proof ? { proof } : {}) } });
  },
};
