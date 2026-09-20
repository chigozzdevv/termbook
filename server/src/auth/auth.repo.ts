import { AuthModel } from "./auth.model.js";

export const authRepo = {
  async touch(wallet: string, expiresAt: number) {
    return AuthModel.findOneAndUpdate(
      { wallet },
      { $inc: { nonce: 1 }, $set: { expiresAt } },
      { upsert: true, new: true },
    ).lean();
  },

  async get(wallet: string) {
    return AuthModel.findOne({ wallet }).lean();
  },

  async consume(wallet: string, nonce: number, now: number) {
    return AuthModel.findOneAndUpdate(
      { wallet, nonce, expiresAt: { $gt: now } },
      { $unset: { expiresAt: 1 } },
      { new: true },
    ).lean();
  },
};
