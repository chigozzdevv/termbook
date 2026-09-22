import { collateralRepo } from "./collateral.repo.js";
import { queue } from "../queue/queue.client.js";
import { env } from "../config/env.js";

export const collateralService = {
  async track(input: Record<string, unknown>) {
    const saved = await collateralRepo.save(input);
    if (env.sourceProofUrl) await queue.push({ kind: "collateral.tracked", payload: { lockId: input["lockId"] } });
    return saved;
  },
  async list(creditId: string) {
    return collateralRepo.listByCredit(creditId);
  },
};
