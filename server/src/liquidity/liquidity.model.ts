import mongoose from "mongoose";

const liquiditySchema = new mongoose.Schema(
  {
    house: String,
    depositor: String,
    shares: { type: String, default: "0" },
    state: { type: String, default: "pending" },
  },
  { timestamps: true },
);

export const LiquidityModel =
  mongoose.models["Liquidity"] ?? mongoose.model("Liquidity", liquiditySchema);
