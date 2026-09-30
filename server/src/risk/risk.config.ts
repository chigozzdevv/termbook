import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";

export function riskKeeper() {
  const key = process.env["RISK_KEEPER_KEY"];
  if (!key) return null;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("risk-keeper-key-invalid");
  if ([env.collateralKeeperKey, env.monadConfirmKeeperKey, env.settlementKeeperKey,
    env.monadWormholePublisherKey, process.env["SOLANA_COLLATERAL_KEEPER_KEY"],
    process.env["ETHEREUM_BEACON_KEEPER_KEY"]].some((other) =>
    other && other.toLowerCase() === key.toLowerCase())) throw new Error("risk-keeper-key-conflict");
  return privateKeyToAccount(key as `0x${string}`);
}

export function riskScanConfig() {
  const integer = (key: string, fallback: number, maximum: number): number => {
    const raw = process.env[key] ?? String(fallback);
    if (!/^\d+$/.test(raw)) throw new Error("risk-scan-config-invalid");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error("risk-scan-config-invalid");
    return value;
  };
  const shards = integer("RISK_SCAN_SHARDS", 1, 256);
  if ((shards & (shards - 1)) !== 0) throw new Error("risk-scan-config-invalid");
  return { shards, pageSize: integer("RISK_SCAN_PAGE_SIZE", 128, 1024),
    concurrency: integer("RISK_SCAN_CONCURRENCY", 8, 32), maxAgeMs: integer("RISK_SCAN_MAX_AGE_MS", 120_000, 3_600_000) };
}
