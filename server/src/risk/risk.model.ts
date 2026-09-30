import mongoose from "mongoose";

const risk = new mongoose.Schema({
  _id: String,
  state: String,
  healthBps: String,
  debt: String,
  block: String,
  blockOrder: String,
  blockHash: String,
  checkedAt: Date,
  failure: String,
}, { timestamps: true });
const scan = new mongoose.Schema({ _id: String, after: String }, { timestamps: true });
export const RiskModel = mongoose.models["TermbookRisk"] ?? mongoose.model("TermbookRisk", risk);
export const RiskScanModel = mongoose.models["TermbookRiskScan"] ?? mongoose.model("TermbookRiskScan", scan);
