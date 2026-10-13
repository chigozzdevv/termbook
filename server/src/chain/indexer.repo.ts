import { randomUUID } from "node:crypto";
import { CoreEventModel, IndexCursorModel } from "./indexer.model.js";

export type IndexCursor = { nextBlock: string; lastBlockHash?: string; lease: string };
const leaseMs = 180_000;
export const indexerRepo = {
  async claim(key: string, start: bigint): Promise<IndexCursor | null> {
    try {
      await IndexCursorModel.updateOne({ _id: key }, { $setOnInsert: { nextBlock: start.toString() } }, { upsert: true });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const row = await IndexCursorModel.findOneAndUpdate({ _id: key, integrityFailure: { $exists: false },
      $or: [{ leaseExpiresAt: { $lte: new Date() } }, { leaseExpiresAt: { $exists: false } }] },
    { $set: { lease: randomUUID(), leaseExpiresAt: new Date(Date.now() + leaseMs) } }, { returnDocument: "after" }).lean();
    if (!row) return null;
    return { nextBlock: String(row["nextBlock"]), lease: String(row["lease"]),
      ...(row["lastBlockHash"] ? { lastBlockHash: String(row["lastBlockHash"]) } : {}) };
  },
  async renew(key: string, lease: string): Promise<boolean> {
    const result = await IndexCursorModel.updateOne({ _id: key, lease, leaseExpiresAt: { $gt: new Date() } },
      { $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) } });
    return result.modifiedCount === 1;
  },
  async record(id: string, event: Record<string, unknown>): Promise<void> {
    await CoreEventModel.updateOne({ _id: id }, { $setOnInsert: event }, { upsert: true });
  },
  async advance(key: string, lease: string, nextBlock: bigint, lastBlockHash: string, eventRevision?: string): Promise<void> {
    const result = await IndexCursorModel.updateOne({ _id: key, lease, leaseExpiresAt: { $gt: new Date() } },
      { $set: { nextBlock: nextBlock.toString(), lastBlockHash, indexedAt: new Date(), ...(eventRevision ? { eventRevision } : {}) } });
    if (result.modifiedCount !== 1) throw new Error("indexer-lease-lost");
  },
  async integrityFailure(key: string, lease: string): Promise<void> {
    await IndexCursorModel.updateOne({ _id: key, lease }, { $set: { integrityFailure: "finalized-block-changed" } });
  },
  async release(key: string, lease: string): Promise<void> {
    await IndexCursorModel.updateOne({ _id: key, lease }, { $unset: { lease: 1, leaseExpiresAt: 1 } });
  },
};
