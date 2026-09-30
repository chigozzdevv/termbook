import { CreditModel } from "../credit/credit.model.js";
import { RiskModel, RiskScanModel } from "./risk.model.js";

export const riskRepo = {
  async page(key: string): Promise<string[]> {
    const cursor = await RiskScanModel.findById(key).lean();
    const after = typeof cursor?.["after"] === "string" ? cursor["after"] : "";
    const rows = await CreditModel.find({ creditId: { $gt: after },
      facility: { $in: ["ready", "closing", "liquidating", "recovery_pending"] } }).sort({ creditId: 1 })
      .limit(64).select("creditId").lean();
    return rows.map((row) => String(row["creditId"]));
  },
  async advance(key: string, after: string): Promise<void> {
    await RiskScanModel.updateOne({ _id: key }, { $set: { after } }, { upsert: true });
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
