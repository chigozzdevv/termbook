import { HouseModel } from "./house.model.js";

export const houseRepo = {
  async upsert(doc: Record<string, unknown>) {
    const normalized = Object.fromEntries(Object.entries(doc).map(([key, value]) =>
      [key, typeof value === "string" ? value.toLowerCase() : value]));
    return HouseModel.findOneAndUpdate({ house: normalized["house"] }, normalized, {
      upsert: true,
      new: true,
    }).lean();
  },
  async list() {
    return HouseModel.find({ active: true }).lean();
  },
  async get(house: string) {
    return HouseModel.findOne({ house: house.toLowerCase(), active: true }).lean();
  },
};
