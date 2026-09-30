import mongoose from "mongoose";

const creditSchema = new mongoose.Schema(
  {
    creditId: { type: String, required: true, unique: true },
    borrower: String,
    bundleId: String,
    house: String,
    facility: { type: String, default: "reserved" },
    debt: { type: String, default: "0" },
    revision: { type: Number, default: 1 },
    observedBlock: Number,
    observedHash: String,
  },
  { timestamps: true },
);
creditSchema.index({ facility: 1, creditId: 1 });

export const CreditModel = mongoose.models["Credit"] ?? mongoose.model("Credit", creditSchema);
