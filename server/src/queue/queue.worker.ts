import { Worker } from "bullmq";
import { queue, redisConnection } from "./queue.client.js";
import { logger } from "../logging/logger.js";

export type Handler = (job: { kind: string; payload: Record<string, unknown> }) => Promise<void>;
const handlers = new Map<string, Handler>();
const workers: Worker[] = [];

export function registerHandler(kinds: string[], fn: Handler): void {
  for (const k of kinds) handlers.set(k, fn);
}

export async function drainQueue(handle: Handler): Promise<number> {
  let n = 0;
  let job = queue.shift();
  while (job) {
    try {
      await handle(job);
      n += 1;
    } catch (err) {
      logger.error("job-failed", { job, err });
    }
    job = queue.shift();
  }
  let claimed = await queue.claim();
  while (claimed) {
    try {
      await handle(claimed.job);
      await queue.complete(claimed.id);
      n += 1;
    } catch (err) {
      await queue.retry(claimed.id);
      logger.error("job-failed", { job: claimed.job, err });
    }
    claimed = await queue.claim();
  }
  return n;
}

export async function startWorkers(): Promise<void> {
  const conn = redisConnection();
  if (!conn) return;
  for (const [kind, fn] of handlers) {
    const w = new Worker(
      kind,
      async (j) => {
        await fn({ kind: j.name, payload: (j.data ?? {}) as Record<string, unknown> });
      },
      { connection: conn.duplicate(), concurrency: 5 },
    );
    w.on("failed", (j, err) => logger.error("worker-failed", { kind, id: j?.id, err }));
    workers.push(w);
  }
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
}
