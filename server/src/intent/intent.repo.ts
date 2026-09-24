import { IntentModel } from "./intent.model.js";
import mongoose from "mongoose";

export const intentRepo = {
  async create(doc: Record<string, unknown>) {
    return IntentModel.create(doc);
  },
  async get(intentId: string) {
    return IntentModel.findOne({ intentId }).lean();
  },
  async listOpen(settlementAsset: string, cursor?: { createdAt: Date; id: string }) {
    return IntentModel.find({ settlementAsset, used: false, status: "open", expiresAt: { $gt: Math.floor(Date.now() / 1000) },
      ...(cursor ? { $or: [{ createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } }] } : {}) })
      .sort({ createdAt: -1, _id: -1 }).limit(100).lean();
  },
  async markUsed(intentId: string) {
    return IntentModel.updateOne({ intentId }, { used: true, status: "used" });
  },
};
