import { drainQueue, registerHandler } from "../queue/queue.worker.js";
import { creditRepo } from "./credit.repo.js";

async function handle(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.kind !== "credit.tracked") return;
  const id = job.payload["creditId"];
  if (typeof id !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(id)) throw new Error("param-invalid");
  const doc = await creditRepo.get(id);
  if (!doc) throw new Error("recovery-blocked");
}

registerHandler(["credit.tracked"], handle);

export async function runCreditWorker(): Promise<number> {
  return drainQueue(handle);
}
