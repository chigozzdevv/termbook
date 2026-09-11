import { HouseModel } from "./house.model.js";

export const houseRepo = {
  async upsert(doc: Record<string, unknown>) {
    return HouseModel.findOneAndUpdate({ house: doc["house"] }, doc, {
      upsert: true,
      new: true,
    }).lean();
  },
  async list() {
    return HouseModel.find({ active: true }).lean();
  },
};
