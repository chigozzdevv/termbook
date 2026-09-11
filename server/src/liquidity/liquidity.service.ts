import { liquidityRepo } from "./liquidity.repo.js";

export const liquidityService = {
  async deposit(input: Record<string, unknown>) {
    return liquidityRepo.save({ ...input, state: "pending" });
  },
  async list(house: string) {
    return liquidityRepo.list(house);
  },
};
