import { Worker } from "bullmq";
import { duplicateRedis, queue, redisConnection } from "./queue.client.js";
import { logger } from "../logging/logger.js";

export type Handler = (job: { kind: string; payload: Record<string, unknown> }) => Promise<void>;
const handlers = new Map<string, Handler>();
const workers: Worker[] = [];

export function registerHandler(kinds: string[], fn: Handler): void {
  for (const k of kinds) handlers.set(k, fn);
}

export async function drainQueue(handle: Handler, kinds: readonly string[]): Promise<number> {
  let n = 0;
  let claimed = await queue.claim(kinds);
  while (claimed) {
    const current = claimed;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void queue.renew(current.id, current.lease).then((renewed) => {
        if (!renewed) leaseLost = true;
      }).catch((err: unknown) => {
        leaseLost = true;
        logger.error("job-lease-renew-failed", { id: current.id, err });
      });
    }, 15_000);
    try {
      await handle(current.job);
      if (leaseLost) throw new Error("job-lease-lost");
      await queue.complete(current.id, current.lease);
      n += 1;
    } catch (err) {
      await queue.retry(current.id, current.lease, current.attempts);
      logger.error("job-failed", { job: current.job, err });
    } finally {
      clearInterval(heartbeat);
    }
    claimed = await queue.claim(kinds);
  }
  return n;
}

export async function startWorkers(): Promise<void> {
  if (workers.length !== 0) return;
  const conn = redisConnection();
  if (!conn) return;
  for (const [kind, fn] of handlers) {
    const w = new Worker(
      kind,
      async (j) => {
        await fn({ kind: j.name, payload: (j.data ?? {}) as Record<string, unknown> });
      },
      { connection: duplicateRedis()!, concurrency: 5 },
    );
    w.on("failed", (j, err) => logger.error("worker-failed", { kind, id: j?.id, err }));
    workers.push(w);
  }
}

export async function stopWorkers(): Promise<void> {
  const results = await Promise.allSettled(workers.map((w) => w.close()));
  for (const result of results) {
    if (result.status === "rejected") logger.error("worker-close-failed", { err: result.reason });
  }
  workers.length = 0;
}
