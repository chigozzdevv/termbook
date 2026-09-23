import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";

export function solanaProofConfig() {
  const rpcUrl = process.env["SOLANA_RPC_URL"];
  const proofUrl = process.env["SOLANA_PROOF_URL"];
  const keeperKey = process.env["SOLANA_COLLATERAL_KEEPER_KEY"];
  if (!rpcUrl && !proofUrl && !keeperKey) return null;
  if (!rpcUrl || !proofUrl || !/^0x[a-fA-F0-9]{64}$/.test(keeperKey ?? "")) {
    throw new Error("solana-proof-config-invalid");
  }
  for (const value of [rpcUrl, proofUrl]) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("solana-proof-config-invalid"); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("solana-proof-config-invalid");
  }
  const keeper = privateKeyToAccount(keeperKey as `0x${string}`);
  for (const other of [env.collateralKeeperKey, env.monadConfirmKeeperKey, env.settlementKeeperKey,
    process.env["RECOVERY_FUNDING_KEY"]]) {
    if (other && /^0x[a-fA-F0-9]{64}$/.test(other)
      && privateKeyToAccount(other as `0x${string}`).address.toLowerCase() === keeper.address.toLowerCase()) {
      throw new Error("solana-proof-keeper-conflict");
    }
  }
  return { rpcUrl, proofUrl, keeper };
}
