import { authRepo } from "./auth.repo.js";
import { env } from "../config/env.js";
import { recoverMessageAddress } from "viem";

export const authService = {
  async nonce(wallet: string) {
    const normalized = wallet.toLowerCase();
    const expiresAt = Math.floor(Date.now() / 1000) + env.authTtlSeconds;
    const doc = await authRepo.touch(normalized, expiresAt);
    const nonce = Number(doc?.["nonce"] ?? 0);
    return {
      wallet: doc?.["wallet"],
      nonce,
      domain: env.authDomain,
      message: `Termbook login ${env.authDomain} ${normalized} ${nonce}`,
      expiresAt,
    };
  },

  async authenticate(wallet: string, signature: string) {
    const normalized = wallet.toLowerCase();
    const challenge = await authRepo.get(normalized);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number(challenge?.["expiresAt"] ?? 0);
    const nonce = Number(challenge?.["nonce"] ?? -1);
    if (!challenge || expiresAt <= now || nonce < 0) throw new Error("auth-expired");
    const message = `Termbook login ${env.authDomain} ${normalized} ${nonce}`;
    const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
    if (recovered.toLowerCase() !== normalized) throw new Error("auth-invalid");
    const consumed = await authRepo.consume(normalized, nonce, now);
    if (!consumed) throw new Error("auth-expired");
    return { wallet: normalized as `0x${string}`, nonce };
  },

  isAdmin(wallet: string) {
    return env.adminWallets.includes(wallet.toLowerCase());
  },
};
