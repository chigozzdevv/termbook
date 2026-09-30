import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";

export function recoveryRelayConfig() {
  const monad = process.env["RECOVERY_RELAY_KEY"];
  const ethereum = process.env["SOURCE_RECOVERY_RELAY_KEY"];
  if (!monad && !ethereum) return null;
  if (![monad, ethereum].every((key) => /^0x[a-fA-F0-9]{64}$/.test(key ?? ""))
    || !env.sourceRpcUrl || !env.settlementFactory || !env.wormholeScanUrl) throw new Error("recovery-relay-config-invalid");
  for (const [key, peers] of [
    [monad!, [env.monadWormholePublisherKey, env.monadConfirmKeeperKey, env.settlementKeeperKey,
      env.collateralKeeperKey, process.env["RISK_KEEPER_KEY"], process.env["SOLANA_COLLATERAL_KEEPER_KEY"],
      process.env["ETHEREUM_BEACON_KEEPER_KEY"]]],
    [ethereum!, [env.sourceActionKeeperKey, env.sourceWormholePublisherKey, process.env["RECOVERY_FUNDING_KEY"]]],
  ] as const) {
    if (peers.some((peer) => peer && peer.toLowerCase() === key.toLowerCase())) throw new Error("recovery-relay-key-conflict");
  }
  return { monad: privateKeyToAccount(monad as `0x${string}`), ethereum: privateKeyToAccount(ethereum as `0x${string}`) };
}
