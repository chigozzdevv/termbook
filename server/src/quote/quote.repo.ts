import { QuoteModel } from "./quote.model.js";

export const quoteRepo = {
  async list(intentId: string) {
    return QuoteModel.aggregate([
      { $match: { intentId, house: { $type: "string" }, expiry: { $gt: Math.floor(Date.now() / 1000) } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: { $toLower: "$house" }, quote: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$quote" } },
    ]);
  },
  async save(doc: Record<string, unknown>) {
    return QuoteModel.create(doc);
  },
};
