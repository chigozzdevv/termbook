import mongoose from "mongoose";

const authSchema = new mongoose.Schema(
  { wallet: { type: String, required: true, unique: true }, nonce: { type: Number, default: 0 }, expiresAt: Number },
  { timestamps: true },
);

export const AuthModel = mongoose.models["Auth"] ?? mongoose.model("Auth", authSchema);
