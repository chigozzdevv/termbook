import { CoreEventModel, IndexCursorModel } from "../chain/indexer.model.js";
import { IntentModel } from "../intent/intent.model.js";
import { env } from "../config/env.js";

const scope = () => ({ chainId: env.monadChainId, core: env.core.toLowerCase() });
export const explorerRepo = {
  async orderPage(cursor?: string, at?: bigint) {
    const finalized = at === undefined ? {} : { $expr: { $lte: [{ $toDecimal: "$block" }, { $toDecimal: { $literal: at.toString() } }] } };
    const result = await CoreEventModel.aggregate([
      { $match: { ...scope(), event: "CreditCreated", ...finalized } },
      { $project: { _id: 0, id: { $toLower: "$creditId" }, kind: { $literal: "credit" } } },
      { $unionWith: { coll: IntentModel.collection.name, pipeline: [
        { $match: { used: false, status: { $ne: "used" } } },
        { $lookup: { from: CoreEventModel.collection.name, let: { intent: "$intentId" }, pipeline: [
          { $match: { ...scope(), event: "CreditCreated", $expr: { $and: [{ $eq: ["$data.intentId", "$$intent"] },
            ...(at === undefined ? [] : [{ $lte: [{ $toDecimal: "$block" }, { $toDecimal: { $literal: at.toString() } }] }])] } } }, { $limit: 1 },
        ], as: "credits" } },
        { $match: { "credits.0": { $exists: false } } },
        { $project: { _id: 0, id: { $toLower: "$intentId" }, kind: { $literal: "request" } } },
      ] } },
      { $group: { _id: "$id", kind: { $first: "$kind" } } },
      { $facet: { records: [...(cursor ? [{ $match: { _id: { $gt: cursor } } }] : []), { $sort: { _id: 1 } }, { $limit: 51 }], total: [{ $count: "count" }] } },
    ]);
    const rows = result[0]?.records as { _id: string; kind: "request" | "credit" }[] ?? [];
    return { records: rows.slice(0, 50).map((row) => ({ id: row._id, kind: row.kind })),
      total: Number(result[0]?.total?.[0]?.count ?? 0), next: rows.length > 50 ? rows[49]!._id : null };
  },
  async creation(id: string) {
    return CoreEventModel.findOne({ ...scope(), event: "CreditCreated", $or: [{ creditId: id }, { "data.intentId": id }] }).lean();
  },
  async intent(id: string) { return IntentModel.findOne({ intentId: id }).lean(); },
  async events(id: string) {
    return CoreEventModel.find({ ...scope(), creditId: id }).select("event block blockHash txHash logIndex data").limit(5001).lean();
  },
  async cursor() { return IndexCursorModel.findById(`${env.monadChainId}:${env.core.toLowerCase()}`).lean(); },
  async upgrades(at: bigint) {
    return CoreEventModel.find({ ...scope(), event: "Upgraded", $expr: { $lte: [{ $toDecimal: "$block" }, { $toDecimal: { $literal: at.toString() } }] } })
      .select("_id").sort({ _id: 1 }).lean();
  },
};
