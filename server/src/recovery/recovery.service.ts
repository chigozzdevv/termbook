import { recoveryRepo } from "./recovery.repo.js";
import { queue } from "../queue/queue.client.js";

export const recoveryService = {
  async open(input: Record<string, unknown>) {
    const saved = await recoveryRepo.open(input);
    await queue.push({ kind: "recovery.opened", payload: { creditId: input["creditId"] } });
    return saved;
  },
  async list(creditId: string) {
    return recoveryRepo.list(creditId);
  },
};
