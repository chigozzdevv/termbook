import { houseRepo } from "./house.repo.js";

export const houseService = {
  async register(input: Record<string, unknown>) {
    return houseRepo.upsert(input);
  },
  async list() {
    return houseRepo.list();
  },
};
