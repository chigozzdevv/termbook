import IORedis from "ioredis";
import { Queue as BullQueue, type JobsOptions } from "bullmq";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import mongoose from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@termbook/schema";

export type Job = { kind: string; payload: Record<string, unknown> };

let shared: IORedis | null = null;
const connections = new Set<IORedis>();
const outboxSchema = new mongoose.Schema({
  jobId: { type: String, unique: true, required: true },
  kind: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ["pending", "processing", "done"], default: "pending" },
  attempts: { type: Number, default: 0 },
  nextRunAt: { type: Date, default: Date.now },
  lease: String,
  leaseExpiresAt: Date,
}, { timestamps: true });
outboxSchema.index({ kind: 1, status: 1, nextRunAt: 1, leaseExpiresAt: 1 });
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
  const queueResults = await Promise.allSettled([...queues.values()].map((value) => value.close()));
  queues.clear();
  const connectionResults = await Promise.allSettled([...connections].map(async (connection) => {
    try { await connection.quit(); } finally { connection.disconnect(); }
  }));
  connections.clear();
  for (const result of [...queueResults, ...connectionResults]) {
    if (result.status === "rejected") logger.error("queue-close-failed", { err: result.reason });
  }
  if (shared) {
    try { await shared.quit(); } catch (err) { logger.error("redis-close-failed", { err }); }
    finally { shared.disconnect(); }
    shared = null;
  }
}

export function duplicateRedis(): IORedis | null {
  const connection = redisConnection()?.duplicate() ?? null;
  if (connection) connections.add(connection);
  return connection;
}

export function jobId(job: Job): string {
  const p = job.payload;
  const raw = (p["operationId"] ??
    p["actionHash"] ??
    p["lockId"] ??
    p["creditId"] ??
    p["intentId"] ??
    canonicalJson(p)) as string;
  return createHash("sha256").update(canonicalJson([job.kind, raw])).digest("hex");
}

function queueFor(kind: string): BullQueue | null {
  const conn = redisConnection();
  if (!conn) return null;
  let q = queues.get(kind);
  if (!q) {
    q = new BullQueue(kind, { connection: duplicateRedis()! });
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
      { upsert: true, returnDocument: "after" },
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
  async claim(kinds: readonly string[]): Promise<{ id: string; lease: string; attempts: number; job: Job } | undefined> {
    if (kinds.length === 0) return undefined;
    if (mongoose.connection.readyState !== 1) return undefined;
    const stale = new Date(Date.now() - 60_000);
    const lease = randomUUID();
    const doc = await JobModel.findOneAndUpdate(
      {
        kind: { $in: kinds },
        $or: [
          { status: "pending", nextRunAt: { $lte: new Date() } },
          { status: "processing", leaseExpiresAt: { $lte: new Date() } },
          { status: "processing", leaseExpiresAt: { $exists: false }, updatedAt: { $lte: stale } },
        ],
      },
      { $set: { status: "processing", lease, leaseExpiresAt: new Date(Date.now() + 60_000) }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    ).lean();
    if (!doc) return undefined;
    return { id: String(doc["jobId"]), lease, attempts: Number(doc["attempts"]),
      job: { kind: String(doc["kind"]), payload: doc["payload"] as Record<string, unknown> } };
  },

  async renew(id: string, lease: string): Promise<boolean> {
    const result = await JobModel.updateOne({ jobId: id, status: "processing", lease,
      leaseExpiresAt: { $gt: new Date() } }, { $set: { leaseExpiresAt: new Date(Date.now() + 60_000) } });
    return result.modifiedCount === 1;
  },

  async complete(id: string, lease: string): Promise<void> {
    await JobModel.deleteOne({ jobId: id, status: "processing", lease });
  },

  async retry(id: string, lease: string, attempts: number): Promise<void> {
    const delay = Math.min(300_000, 2000 * 2 ** Math.min(8, Math.max(0, attempts - 1)));
    await JobModel.updateOne({ jobId: id, status: "processing", lease }, {
      $set: { status: "pending", nextRunAt: new Date(Date.now() + delay) },
      $unset: { lease: 1, leaseExpiresAt: 1 },
    });
  },
};
