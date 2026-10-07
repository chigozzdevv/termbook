import { readFile } from "node:fs/promises";
import { Keypair, PublicKey } from "@solana/web3.js";
import { solanaProofConfig } from "./solana.config.js";
import { env } from "../config/env.js";

export async function solanaRelayConfig() {
  const path = process.env["SOLANA_SOURCE_KEEPER_KEY_FILE"];
  const secret = process.env["SOLANA_SOURCE_KEEPER_SECRET"];
  if (!path && !secret) return null;
  const proof = solanaProofConfig();
  if (!proof || !env.wormholeScanUrl || path && secret) throw new Error("solana-relay-config-invalid");
  let data: unknown;
  try { data = JSON.parse(path ? await readFile(path, "utf8") : secret!); }
  catch { throw new Error("solana-relay-key-invalid"); }
  if (!Array.isArray(data) || data.length !== 64 || !data.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new Error("solana-relay-key-invalid");
  }
  let signer: Keypair;
  try { signer = Keypair.fromSecretKey(Uint8Array.from(data)); } catch { throw new Error("solana-relay-key-invalid"); }
  const maxTransactions = Number(process.env["SOLANA_SOURCE_MAX_TRANSACTIONS"] ?? 64);
  if (!Number.isInteger(maxTransactions) || maxTransactions < 8 || maxTransactions > 128) throw new Error("solana-relay-budget-invalid");
  const testnetUpgradeAuthority = process.env["SOLANA_TESTNET_UPGRADE_AUTHORITY"];
  if (testnetUpgradeAuthority) {
    if (env.monadChainId !== 10143) throw new Error("solana-testnet-upgrade-authority-invalid");
    try { if (new PublicKey(testnetUpgradeAuthority).equals(PublicKey.default)) throw new Error(); }
    catch { throw new Error("solana-testnet-upgrade-authority-invalid"); }
  }
  return { ...proof, signer, maxTransactions, wormholeScanUrl: env.wormholeScanUrl, testnetUpgradeAuthority };
}
