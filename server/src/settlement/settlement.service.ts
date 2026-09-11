import { settlementRepo } from "./settlement.repo.js";
import { queue } from "../queue/queue.client.js";

export const settlementService = {
  async register(input: Record<string, unknown>) {
    const saved = await settlementRepo.save(input);
    await queue.push({ kind: "settlement.registered", payload: { operationId: input["operationId"] } });
    return saved;
  },
  async get(operationId: string) {
    return settlementRepo.get(operationId);
  },
};
