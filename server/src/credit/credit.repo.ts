import { CreditModel } from "./credit.model.js";

export const creditRepo = {
  async save(doc: Record<string, unknown>) {
    const revision = doc["revision"];
    const observedBlock = doc["observedBlock"];
    if (!Number.isSafeInteger(revision) || Number(revision) <= 0) throw new Error("credit-revision-invalid");
    if (!Number.isSafeInteger(observedBlock) || Number(observedBlock) < 0) throw new Error("credit-block-invalid");
    try {
      return await CreditModel.findOneAndUpdate({ creditId: doc["creditId"],
        $and: [
          { $or: [{ revision: { $lte: revision } }, { revision: { $exists: false } }] },
          { $or: [{ observedBlock: { $lte: observedBlock } }, { observedBlock: { $exists: false } }] },
        ] }, { $set: doc }, {
        upsert: true, returnDocument: "after",
      }).lean();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const current = await CreditModel.findOne({ creditId: doc["creditId"] }).lean();
      if (!current || Number(current["revision"]) < Number(revision)
        && Number(current["observedBlock"] ?? 0) < Number(observedBlock)) throw error;
      return current;
    }
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
