import { authRepo } from "./auth.repo.js";
import { env } from "../config/env.js";
import { recoverMessageAddress } from "viem";

const issued = new Map<string, { nonce: number; expiresAt: number }>();

export const authService = {
  async nonce(wallet: string) {
    const doc = await authRepo.touch(wallet.toLowerCase());
    const nonce = Number(doc?.["nonce"] ?? 0);
    const expiresAt = Math.floor(Date.now() / 1000) + env.authTtlSeconds;
    issued.set(wallet.toLowerCase(), { nonce, expiresAt });
    return {
      wallet: doc?.["wallet"],
      nonce,
      domain: env.authDomain,
      message: `Termbook login ${env.authDomain} ${wallet.toLowerCase()} ${nonce}`,
      expiresAt,
    };
  },

  async authenticate(wallet: string, signature: string) {
    const normalized = wallet.toLowerCase();
    const challenge = issued.get(normalized);
    if (!challenge || challenge.expiresAt < Math.floor(Date.now() / 1000)) throw new Error("auth-expired");
    const message = `Termbook login ${env.authDomain} ${normalized} ${challenge.nonce}`;
    const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
    if (recovered.toLowerCase() !== normalized) throw new Error("auth-invalid");
    issued.delete(normalized);
    return { wallet: normalized as `0x${string}`, nonce: challenge.nonce };
  },

  isAdmin(wallet: string) {
    return env.adminWallets.includes(wallet.toLowerCase());
  },
};
