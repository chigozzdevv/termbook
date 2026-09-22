import { recoveryRepo } from "./recovery.repo.js";
import { HttpError } from "../http/http.errors.js";

export const recoveryService = {
  async open(_input: Record<string, unknown>) {
    throw new HttpError(503, "recovery-route-unavailable");
  },
  async list(creditId: string) {
    return recoveryRepo.list(creditId);
  },
};
