import { authRepo } from "./auth.repo.js";
import { env } from "../config/env.js";
import { hashMessage, parseAbi, recoverMessageAddress } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { apiAuthorizationMessage, type ApiAuthorization } from "@termbook/schema";
import { randomBytes } from "node:crypto";

const erc1271Abi = parseAbi(["function isValidSignature(bytes32,bytes) view returns (bytes4)"]);

async function validSignature(wallet: string, message: string, signature: string): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
    if (recovered.toLowerCase() === wallet) return true;
  } catch { /* Check contract signatures below. */ }
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet) || /^0x0{40}$/i.test(wallet)) return false;
  try {
    const chain = monadClient();
    const block = await chain.getBlock({ blockTag: "finalized" });
    const code = await chain.getBytecode({ address: wallet as `0x${string}`, blockNumber: block.number });
    if (!code || code === "0x") return false;
    const result = await chain.readContract({ address: wallet as `0x${string}`, abi: erc1271Abi,
      functionName: "isValidSignature", args: [hashMessage(message), signature as `0x${string}`],
      blockNumber: block.number });
    return result.toLowerCase() === "0x1626ba7e";
  } catch {
    return false;
  }
}

export const authService = {
  async nonce(wallet: string, request: ApiAuthorization) {
    const normalized = wallet.toLowerCase();
    const expiresAt = Math.floor(Date.now() / 1000) + env.authTtlSeconds;
    const nonce = `${randomBytes(32).toString("hex")}.${expiresAt}`;
    return {
      wallet: normalized,
      nonce,
      domain: env.authDomain,
      message: apiAuthorizationMessage(env.authDomain, normalized, nonce, expiresAt, request),
      expiresAt,
    };
  },

  async authenticate(wallet: string, signature: string, nonce: string, request: ApiAuthorization) {
    const normalized = wallet.toLowerCase();
    const challenge = /^([a-f0-9]{64})\.([0-9]{1,12})$/.exec(nonce);
    if (!challenge) throw new Error("auth-invalid");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number(challenge[2]);
    if (expiresAt <= now || expiresAt > now + env.authTtlSeconds) throw new Error("auth-expired");
    const message = apiAuthorizationMessage(env.authDomain, normalized, nonce, expiresAt, request);
    if (!await validSignature(normalized, message, signature)) throw new Error("auth-invalid");
    const consumed = await authRepo.consume(normalized, nonce, expiresAt);
    if (!consumed) throw new Error("auth-expired");
    return { wallet: normalized as `0x${string}`, nonce };
  },

  isAdmin(wallet: string) {
    return env.adminWallets.includes(wallet.toLowerCase());
  },
};
