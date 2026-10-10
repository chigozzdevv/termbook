import { randomUUID } from "node:crypto";
import { CreditModel } from "../credit/credit.model.js";
import { RiskModel, RiskScanModel } from "./risk.model.js";

export const riskRepo = {
  async claim(key: string, shard: number, shards: number) {
    if (!Number.isInteger(shard) || !Number.isInteger(shards) || shard < 0 || shard >= shards || shards < 1 || shards > 256 || (shards & (shards - 1)) !== 0) throw new Error("risk-shard-invalid");
    const lower = `0x${((BigInt(shard) << 256n) / BigInt(shards)).toString(16).padStart(64, "0")}`;
    const upper = shard === shards - 1 ? null : `0x${((BigInt(shard + 1) << 256n) / BigInt(shards)).toString(16).padStart(64, "0")}`;
    const id = `${key}:scan:${shards}:${shard}`, lease = randomUUID();
    try { await RiskScanModel.updateOne({ _id: id }, { $setOnInsert: { after: "", lower, upper, cycleStartedAt: new Date() } }, { upsert: true }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    const cursor = await RiskScanModel.findOneAndUpdate({ _id: id, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date() } }] },
      { $set: { lease, leaseUntil: new Date(Date.now() + 120_000) } }, { returnDocument: "after" }).lean();
    return cursor ? { id, lease, lower, upper, after: String(cursor["after"] ?? ""),
      cycleCompletedAt: cursor["cycleCompletedAt"] as Date | undefined, cycleStartedAt: cursor["cycleStartedAt"] as Date | undefined } : null;
  },
  async renew(id: string, lease: string): Promise<boolean> {
    return (await RiskScanModel.updateOne({ _id: id, lease, leaseUntil: { $gt: new Date() } },
      { $set: { leaseUntil: new Date(Date.now() + 120_000) } })).matchedCount === 1;
  },
  async page(scan: { lower: string; upper: string | null; after: string }, limit: number): Promise<string[]> {
    const rows = await CreditModel.find({ creditId: { $gte: scan.lower, ...(scan.upper ? { $lt: scan.upper } : {}),
      ...(scan.after ? { $gt: scan.after } : {}) }, facility: { $in: ["ready", "closing", "liquidating", "recovery_pending"] } })
      .sort({ creditId: 1 }).limit(limit).select("creditId").lean();
    return rows.map((row) => String(row["creditId"]));
  },
  async advance(scan: { id: string; lease: string }, after: string, block: string, complete: boolean): Promise<void> {
    const result = await RiskScanModel.updateOne({ _id: scan.id, lease: scan.lease, leaseUntil: { $gt: new Date() } },
      { $set: { after: complete ? "" : after, processedAt: new Date(), processedBlock: block,
        ...(complete ? { cycleCompletedAt: new Date(), cycleStartedAt: new Date() } : {}) },
        ...(complete ? { $inc: { cycles: 1 } } : {}), $unset: { lease: 1, leaseUntil: 1 } });
    if (result.modifiedCount !== 1) throw new Error("risk-scan-lease-lost");
  },
  async release(id: string, lease: string): Promise<void> {
    await RiskScanModel.updateOne({ _id: id, lease }, { $unset: { lease: 1, leaseUntil: 1 } });
  },
  async scanHealthy(key: string, shards: number, maxAgeMs: number): Promise<boolean> {
    const count = await CreditModel.countDocuments({ facility: { $in: ["ready", "closing", "liquidating", "recovery_pending"] } });
    if (count === 0) return true;
    const ids = Array.from({ length: shards }, (_, shard) => `${key}:scan:${shards}:${shard}`);
    const scans = await RiskScanModel.find({ _id: { $in: ids } }).select("cycleCompletedAt processedAt").lean();
    return scans.length === shards && scans.every((scan) => scan["cycleCompletedAt"] instanceof Date
      && Date.now() - scan["cycleCompletedAt"].getTime() <= maxAgeMs && scan["processedAt"] instanceof Date
      && Date.now() - scan["processedAt"].getTime() <= maxAgeMs);
  },
  async record(key: string, state: Record<string, unknown>): Promise<void> {
    if (typeof state["block"] !== "string" || !/^\d{1,78}$/.test(state["block"])
      || typeof state["blockHash"] !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(state["blockHash"])) {
      throw new Error("risk-projection-invalid");
    }
    const blockOrder = BigInt(state["block"]).toString().padStart(78, "0");
    try {
      await RiskModel.updateOne({ _id: key, $or: [
        { blockOrder: { $exists: false } }, { blockOrder: { $lt: blockOrder } },
        { blockOrder, blockHash: state["blockHash"] },
      ] }, { $set: { ...state, blockOrder, checkedAt: new Date() } }, { upsert: true });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const current = await RiskModel.findById(key).lean();
      if (current?.["blockOrder"] === blockOrder && current["blockHash"] !== state["blockHash"]) {
        throw new Error("risk-finality-conflict", { cause: error });
      }
    }
  },
};
