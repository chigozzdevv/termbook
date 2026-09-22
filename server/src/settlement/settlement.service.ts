import { settlementRepo } from "./settlement.repo.js";
import { HttpError } from "../http/http.errors.js";

export const settlementService = {
  async register(_input: Record<string, unknown>) {
    throw new HttpError(503, "settlement-route-unavailable");
  },
  async get(operationId: string) {
    return settlementRepo.get(operationId);
  },
};
