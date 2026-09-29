import { AuthModel } from "./auth.model.js";
import { createHash } from "node:crypto";

export const authRepo = {
  async consume(wallet: string, nonce: string, expiresAt: number): Promise<boolean> {
    const id = createHash("sha256").update(`${wallet}\0${nonce}`).digest("hex");
    try {
      await AuthModel.create({ _id: id, wallet, expiresOn: new Date(expiresAt * 1000) });
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) return false;
      throw error;
    }
  },
};
