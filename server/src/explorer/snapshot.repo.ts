import { randomUUID } from "node:crypto";
import { explorerHouseSchema, explorerOrderSchema, explorerSnapshotSchema, type ExplorerHouse, type ExplorerOrder } from "@termbook/schema";
import { env } from "../config/env.js";
import { HttpError } from "../http/http.errors.js";
import { ExplorerManifestModel, ExplorerRecordModel } from "./snapshot.model.js";

const scope = () => `${env.monadChainId}:${env.core.toLowerCase()}`;
export type Snapshot = { generation: string; block: string; updatedAt: string; publishedAt: Date;
  orderCount: number; houseCount: number; version: string; eventRevision?: string };
export type Publication = { block: string; updatedAt: string; version: string; eventRevision?: string; houses: ExplorerHouse[]; orders: ExplorerOrder[] };
const query = (generation: string) => ({ scope: scope(), generation });
export const snapshotRepo = {
  async current(generation?: string): Promise<Snapshot | null> {
    const row = await ExplorerManifestModel.findById(generation ? `${scope()}:${generation}` : scope()).maxTimeMS(5000).lean();
    return row?.generation && row.complete ? row as unknown as Snapshot : null;
  },
  async houses(snapshot: Snapshot) {
    const rows = await ExplorerRecordModel.find({ ...query(snapshot.generation), kind: "house" }).sort({ id: 1 }).maxTimeMS(5000).lean();
    if (rows.length !== snapshot.houseCount) throw new Error("explorer-snapshot-incomplete");
    return rows.map((row) => explorerHouseSchema.parse({ ...row.data, snapshot: explorerSnapshotSchema.parse(snapshot) }));
  },
  async orders(snapshot: Snapshot, cursor?: string) {
    const rows = await ExplorerRecordModel.find({ ...query(snapshot.generation), kind: "order", ...(cursor ? { id: { $gt: cursor } } : {}) })
      .sort({ id: 1 }).limit(51).maxTimeMS(5000).lean();
    return { records: rows.slice(0, 50).map((row) => explorerOrderSchema.parse({ ...row.data, snapshot: explorerSnapshotSchema.parse(snapshot) })),
      total: snapshot.orderCount, next: rows.length > 50 ? String(rows[49]!.id) : null,
      block: snapshot.block, snapshot: explorerSnapshotSchema.parse(snapshot) };
  },
  async order(snapshot: Snapshot, id: string) {
    const row = await ExplorerRecordModel.findOne({ ...query(snapshot.generation), kind: "order", $or: [{ id }, { intentId: id }] }).maxTimeMS(5000).lean();
    return row ? explorerOrderSchema.parse({ ...row.data, snapshot: explorerSnapshotSchema.parse(snapshot) }) : null;
  },
  async house(snapshot: Snapshot, id: string) {
    const row = await ExplorerRecordModel.findOne({ ...query(snapshot.generation), kind: "house", id }).maxTimeMS(5000).lean();
    return row ? explorerHouseSchema.parse({ ...row.data, snapshot: explorerSnapshotSchema.parse(snapshot) }) : null;
  },
  async priorOrders(snapshot: Snapshot): Promise<ExplorerOrder[]> {
    const rows = await ExplorerRecordModel.find({ ...query(snapshot.generation), kind: "order" }).maxTimeMS(5000).lean();
    return rows.map((row) => explorerOrderSchema.parse(row.data));
  },
  async claim(): Promise<string | null> {
    const lease = randomUUID();
    try { await ExplorerManifestModel.updateOne({ _id: scope() }, { $setOnInsert: { scope: scope() } }, { upsert: true }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    const row = await ExplorerManifestModel.findOneAndUpdate({ _id: scope(),
      $or: [{ leaseExpiresAt: { $lte: new Date() } }, { leaseExpiresAt: { $exists: false } }] },
    { $set: { lease, leaseExpiresAt: new Date(Date.now() + 180_000) } }, { returnDocument: "after" }).lean();
    return row ? lease : null;
  },
  async renew(lease: string) {
    const result = await ExplorerManifestModel.updateOne({ _id: scope(), lease, leaseExpiresAt: { $gt: new Date() } },
      { $set: { leaseExpiresAt: new Date(Date.now() + 180_000) } });
    return result.matchedCount === 1;
  },
  async release(lease: string) {
    await ExplorerManifestModel.updateOne({ _id: scope(), lease }, { $unset: { lease: 1, leaseExpiresAt: 1 } });
  },
  async publish(input: Publication, lease: string) {
    const previous = await snapshotRepo.current();
    if (previous && BigInt(input.block) < BigInt(previous.block)) throw new Error("explorer-snapshot-regression");
    const generation = randomUUID(), metadata = { ...query(generation), block: input.block, updatedAt: input.updatedAt,
      publishedAt: new Date(), orderCount: input.orders.length, houseCount: input.houses.length, version: input.version, eventRevision: input.eventRevision ?? "" };
    explorerSnapshotSchema.parse(metadata);
    const rows = [...input.houses.map((data) => ({ kind: "house", id: data.house.toLowerCase(), data: explorerHouseSchema.parse(data) })),
      ...input.orders.map((data) => ({ kind: "order", id: data.id.toLowerCase(), intentId: data.intentId.toLowerCase(), data: explorerOrderSchema.parse(data) }))]
      .map((row) => ({ ...row, ...query(generation), _id: `${scope()}:${generation}:${row.kind}:${row.id}` }));
    await ExplorerManifestModel.create({ _id: `${scope()}:${generation}`, ...metadata, complete: false });
    if (rows.length) await ExplorerRecordModel.insertMany(rows, { ordered: true });
    await ExplorerManifestModel.updateOne({ _id: `${scope()}:${generation}` }, { $set: { complete: true } });
    const result = await ExplorerManifestModel.updateOne({ _id: scope(), lease, leaseExpiresAt: { $gt: new Date() } }, { $set: { ...metadata, complete: true } });
    if (result.matchedCount !== 1) throw new Error("explorer-snapshot-lease-lost");
    const expired = await ExplorerManifestModel.find({ scope: scope(), _id: { $ne: scope() },
      generation: { $nin: [generation, previous?.generation].filter(Boolean) }, publishedAt: { $lt: new Date(Date.now() - 600_000) } }).select("generation").lean();
    const generations = expired.map((row) => row.generation);
    if (generations.length) {
      await ExplorerRecordModel.deleteMany({ scope: scope(), generation: { $in: generations } });
      await ExplorerManifestModel.deleteMany({ scope: scope(), _id: { $ne: scope() }, generation: { $in: generations } });
    }
  },
};

export async function requireSnapshot(generation?: string) {
  const snapshot = await snapshotRepo.current(generation);
  if (!snapshot) throw new HttpError(generation ? 409 : 503, generation ? "explorer-snapshot-expired" : "explorer-snapshot-unavailable");
  return snapshot;
}
