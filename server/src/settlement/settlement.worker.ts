import { drainQueue, registerHandler } from "../queue/queue.worker.js";
import { settlementRepo } from "./settlement.repo.js";

async function handle(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.kind !== "settlement.registered" && job.kind !== "settle-finalize") return;
  const id = job.payload["operationId"];
  if (typeof id !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(id)) throw new Error("param-invalid");
  const doc = (await settlementRepo.get(id)) as {
    received?: string;
    applied?: string;
    refunded?: string;
  } | null;
  if (!doc) throw new Error("recovery-blocked");
  const received = BigInt(doc.received ?? "0");
  const applied = BigInt(doc.applied ?? "0");
  const refunded = BigInt(doc.refunded ?? "0");
  if (applied + refunded > received) throw new Error("settle-failed");
}

registerHandler(["settlement.registered", "settle-finalize"], handle);

export async function runSettlementWorker(): Promise<number> {
  return drainQueue(handle);
}
