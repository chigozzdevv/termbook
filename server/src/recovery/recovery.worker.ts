import { drainQueue, registerHandler } from "../queue/queue.worker.js";
import { recoveryRepo } from "./recovery.repo.js";
import { creditRepo } from "../credit/credit.repo.js";

async function handle(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.kind !== "recovery.opened" && job.kind !== "recovery-run") return;
  const id = job.payload["creditId"];
  if (typeof id !== "string") throw new Error("param-invalid");
  const credit = (await creditRepo.get(id)) as { facility?: string } | null;
  if (!credit) throw new Error("recovery-blocked");
  if (
    credit.facility !== undefined &&
    !["liquidating", "recovery_pending", "ready"].includes(credit.facility)
  ) {
    throw new Error("recovery-blocked");
  }
  await recoveryRepo.list(id);
}

registerHandler(["recovery.opened", "recovery-run"], handle);

export async function runRecoveryWorker(): Promise<number> {
  return drainQueue(handle);
}
