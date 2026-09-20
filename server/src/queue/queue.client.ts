import IORedis from "ioredis";
import { Queue as BullQueue, type JobsOptions } from "bullmq";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import mongoose from "mongoose";

export type Job = { kind: string; payload: Record<string, unknown> };

let shared: IORedis | null = null;
const outboxSchema = new mongoose.Schema({
  jobId: { type: String, unique: true, required: true },
  kind: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ["pending", "processing", "done"], default: "pending" },
  attempts: { type: Number, default: 0 },
  nextRunAt: { type: Date, default: Date.now },
}, { timestamps: true });
const JobModel = mongoose.models["TermbookJob"] ?? mongoose.model("TermbookJob", outboxSchema);
const queues = new Map<string, BullQueue>();
const defaults: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export function redisConnection(): IORedis | null {
  if (!env.redisUrl) return null;
  if (!shared) shared = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit();
    shared = null;
  }
}

export function jobId(job: Job): string {
  const p = job.payload;
  const raw = (p["operationId"] ??
    p["lockId"] ??
    p["creditId"] ??
    p["intentId"] ??
    JSON.stringify(p)) as string;
  return `${job.kind}:${raw}`;
}

function queueFor(kind: string): BullQueue | null {
  const conn = redisConnection();
  if (!conn) return null;
  let q = queues.get(kind);
  if (!q) {
    q = new BullQueue(kind, { connection: conn.duplicate() });
    queues.set(kind, q);
  }
  return q;
}

async function fallback(job: Job): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    throw new Error("durable-queue-unavailable");
  }
  try {
    await JobModel.findOneAndUpdate(
      { jobId: jobId(job) },
      { $setOnInsert: { jobId: jobId(job), kind: job.kind, payload: job.payload, status: "pending", attempts: 0, nextRunAt: new Date() } },
      { upsert: true, new: true },
    );
  } catch (err) {
    logger.error("outbox-push-failed", { job, err });
    throw new Error("durable-queue-unavailable", { cause: err });
  }
}

export const queue = {
  async push(job: Job): Promise<void> {
    const q = queueFor(job.kind);
    if (!q) {
      await fallback(job);
      return;
    }
    try {
      await q.add(job.kind, job.payload, { ...defaults, jobId: jobId(job) });
    } catch (err) {
      logger.error("queue-push-failed", { job, err });
      await fallback(job);
    }
  },
  async claim(): Promise<{ id: string; job: Job } | undefined> {
    if (mongoose.connection.readyState !== 1) return undefined;
    const stale = new Date(Date.now() - 60_000);
    const doc = await JobModel.findOneAndUpdate(
      {
        $or: [
          { status: "pending", nextRunAt: { $lte: new Date() } },
          { status: "processing", updatedAt: { $lte: stale } },
        ],
      },
      { $set: { status: "processing" }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, new: true },
    ).lean();
    if (!doc) return undefined;
    return { id: String(doc["jobId"]), job: { kind: String(doc["kind"]), payload: doc["payload"] as Record<string, unknown> } };
  },

  async complete(id: string): Promise<void> {
    await JobModel.deleteOne({ jobId: id });
  },

  async retry(id: string): Promise<void> {
    await JobModel.updateOne({ jobId: id }, { $set: { status: "pending", nextRunAt: new Date(Date.now() + 2000) } });
  },
};
