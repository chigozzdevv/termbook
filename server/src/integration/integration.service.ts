import { integrationRepo } from "./integration.repo.js";

export const integrationService = {
  async approve(input: Record<string, unknown>) {
    return integrationRepo.upsert(input);
  },
  async list() {
    return integrationRepo.list();
  },
};
