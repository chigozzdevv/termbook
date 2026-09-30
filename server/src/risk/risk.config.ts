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
