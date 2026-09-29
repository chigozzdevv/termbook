import mongoose from "mongoose";

const authSchema = new mongoose.Schema(
  { _id: { type: String, required: true }, wallet: { type: String, required: true }, expiresOn: Date },
  { timestamps: true },
);

authSchema.index({ expiresOn: 1 }, { expireAfterSeconds: 0 });

export const AuthModel = mongoose.models["TermbookUsedAuthorization"]
  ?? mongoose.model("TermbookUsedAuthorization", authSchema);
