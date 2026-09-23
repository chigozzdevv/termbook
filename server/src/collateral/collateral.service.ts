import { collateralRepo } from "./collateral.repo.js";
import { queue } from "../queue/queue.client.js";
import { env } from "../config/env.js";

export const collateralService = {
  async track(input: Record<string, unknown>) {
    if (!env.sourceRpcUrl || !env.sourceProofUrl || !env.collateralKeeperKey) {
      throw new Error("collateral-worker-unavailable");
    }
    const saved = await collateralRepo.save(input);
    await queue.push({ kind: "collateral.tracked", payload: { lockId: input["lockId"] } });
    return saved;
  },
  async list(creditId: string) {
    return collateralRepo.listByCredit(creditId);
  },
};
