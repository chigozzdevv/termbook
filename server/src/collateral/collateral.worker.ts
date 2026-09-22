import { drainQueue, registerHandler } from "../queue/queue.worker.js";
import { fetchProof } from "../chain/source.client.js";
import { collateralRepo } from "./collateral.repo.js";
import { env } from "../config/env.js";

async function handle(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.kind !== "collateral.tracked") return;
  const lockId = job.payload["lockId"];
  if (typeof lockId !== "string") throw new Error("param-invalid");
  if (!env.sourceProofUrl) throw new Error("proof-source-required");
  const proof = await fetchProof(env.sourceProofUrl, lockId);
  await collateralRepo.setState(lockId, "proof_fetched", proof);
}

if (env.sourceProofUrl) registerHandler(["collateral.tracked"], handle);

export async function runCollateralWorker(): Promise<number> {
  return env.sourceProofUrl ? drainQueue(handle, ["collateral.tracked"]) : 0;
}
