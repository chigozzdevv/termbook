import { collateralRepo } from "./collateral.repo.js";
import { queue } from "../queue/queue.client.js";

export const collateralService = {
  async track(input: Record<string, unknown>) {
    const saved = await collateralRepo.save(input);
    await queue.push({ kind: "collateral.tracked", payload: { lockId: input["lockId"], sourceRpc: input["sourceRpc"] } });
    return saved;
  },
  async list(creditId: string) {
    return collateralRepo.listByCredit(creditId);
  },
};
