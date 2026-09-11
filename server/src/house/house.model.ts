import mongoose from "mongoose";

const houseSchema = new mongoose.Schema(
  {
    house: { type: String, required: true, unique: true },
    vault: String,
    asset: String,
    manager: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const HouseModel = mongoose.models["House"] ?? mongoose.model("House", houseSchema);
