import mongoose from "mongoose";

const collateralSchema = new mongoose.Schema(
  {
    lockId: { type: String, required: true, unique: true },
    creditId: String,
    amount: String,
    owner: String,
    state: { type: String, default: "pending" },
    proof: mongoose.Schema.Types.Mixed,
    txHash: String,
    rawTx: String,
  },
  { timestamps: true },
);

export const CollateralModel =
  mongoose.models["Collateral"] ?? mongoose.model("Collateral", collateralSchema);

const collateralSignerSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  lockId: String,
}, { timestamps: true });

export const CollateralSignerModel = mongoose.models["CollateralSigner"]
  ?? mongoose.model("CollateralSigner", collateralSignerSchema);
