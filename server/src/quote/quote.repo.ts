import { QuoteModel } from "./quote.model.js";

export const quoteRepo = {
  async list(intentId: string) {
    return QuoteModel.find({ intentId, expiry: { $gt: Math.floor(Date.now() / 1000) } }).sort({ aprBps: 1 }).limit(5).lean();
  },
  async save(doc: Record<string, unknown>) {
    return QuoteModel.create(doc);
  },
};
