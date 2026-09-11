import { creditRepo } from "./credit.repo.js";
import { queue } from "../queue/queue.client.js";

export const creditService = {
  async track(input: Record<string, unknown>) {
    const saved = await creditRepo.save(input);
    await queue.push({ kind: "credit.tracked", payload: { creditId: input["creditId"] } });
    return saved;
  },
  async get(creditId: string) {
    return creditRepo.get(creditId);
  },
};
