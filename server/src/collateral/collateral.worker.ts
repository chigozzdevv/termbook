import { drainQueue, registerHandler } from "../queue/queue.worker.js";
import { fetchProof } from "../chain/source.client.js";
import { collateralRepo } from "./collateral.repo.js";

async function handle(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.kind !== "collateral.tracked") return;
  const lockId = job.payload["lockId"];
  const rpc = job.payload["sourceRpc"];
  if (typeof lockId !== "string") throw new Error("param-invalid");
  if (typeof rpc !== "string" || rpc.length === 0) throw new Error("proof-source-required");
  const proof = await fetchProof(rpc, lockId);
  await collateralRepo.setState(lockId, "proof_fetched", proof);
}

registerHandler(["collateral.tracked"], handle);

export async function runCollateralWorker(): Promise<number> {
  return drainQueue(handle, ["collateral.tracked"]);
}
