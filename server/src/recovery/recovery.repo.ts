import { RecoveryModel } from "./recovery.model.js";

export const recoveryRepo = {
  async open(doc: Record<string, unknown>) {
    return RecoveryModel.create({ ...doc, state: "open" });
  },
  async list(creditId: string) {
    return RecoveryModel.find({ creditId }).lean();
  },
};
