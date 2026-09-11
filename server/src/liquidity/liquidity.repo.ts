import { LiquidityModel } from "./liquidity.model.js";

export const liquidityRepo = {
  async save(doc: Record<string, unknown>) {
    return LiquidityModel.create(doc);
  },
  async list(house: string) {
    return LiquidityModel.find({ house }).lean();
  },
};
