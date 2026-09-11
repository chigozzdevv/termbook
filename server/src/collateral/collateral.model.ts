import mongoose from "mongoose";

const collateralSchema = new mongoose.Schema(
  {
    lockId: { type: String, required: true, unique: true },
    creditId: String,
    amount: String,
    owner: String,
    sourceRpc: String,
    state: { type: String, default: "pending" },
    proof: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

export const CollateralModel =
  mongoose.models["Collateral"] ?? mongoose.model("Collateral", collateralSchema);
