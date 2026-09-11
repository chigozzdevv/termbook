import { AuthModel } from "./auth.model.js";

export const authRepo = {
  async touch(wallet: string) {
    return AuthModel.findOneAndUpdate(
      { wallet },
      { $inc: { nonce: 1 } },
      { upsert: true, new: true },
    ).lean();
  },

  async get(wallet: string) {
    return AuthModel.findOne({ wallet }).lean();
  },
};
