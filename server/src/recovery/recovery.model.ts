import mongoose from "mongoose";

const recoverySchema = new mongoose.Schema(
  {
    creditId: String,
    kind: { type: String, enum: ["partial", "full"] },
    state: { type: String, default: "open" },
  },
  { timestamps: true },
);

export const RecoveryModel =
  mongoose.models["Recovery"] ?? mongoose.model("Recovery", recoverySchema);
