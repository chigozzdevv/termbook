import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { monadClient } from "./monad.client.js";
import { reconcileKeeperWallet } from "./keeper.js";
import { configuredEvmSources } from "./networks.js";

export async function runKeeperWorker(): Promise<number> {
  const wallets = new Map<string, { client: PublicClient; chainId: number; address: Address }>();
  for (const [chainId, rpcUrl, keys] of [
    [env.monadChainId, env.rpcUrl, [env.settlementKeeperKey,
      env.collateralKeeperKey, env.monadConfirmKeeperKey, env.monadWormholePublisherKey,
      process.env["SOLANA_COLLATERAL_KEEPER_KEY"], process.env["ORACLE_KEEPER_KEY"],
      process.env["RISK_KEEPER_KEY"], process.env["RECOVERY_RELAY_KEY"], process.env["UPGRADE_MONITOR_KEY"]]],
    ...configuredEvmSources().map(({ chainId, rpcUrl }) => [chainId, rpcUrl, [env.sourceWormholePublisherKey, env.sourceActionKeeperKey,
      process.env["SOURCE_RECOVERY_RELAY_KEY"]]] as const),
  ] as const) {
    if (!rpcUrl) continue;
    for (const key of keys) {
      if (!key) continue;
      const address = privateKeyToAccount(key as `0x${string}`).address;
      const priority = key === process.env["UPGRADE_MONITOR_KEY"] ? 2
        : key === process.env["ORACLE_KEEPER_KEY"] || key === process.env["RISK_KEEPER_KEY"] ? 1 : 0;
      const client = chainId === env.monadChainId ? monadClient(priority) : createPublicClient({ transport: http(rpcUrl) });
      wallets.set(`${chainId}:${address.toLowerCase()}`, { client, chainId, address });
    }
  }
  const results = await Promise.allSettled([...wallets.values()].map(({ client, chainId, address }) =>
    reconcileKeeperWallet(client, chainId, address)));
  let completed = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      if (result.value === "success" || result.value === "reverted") completed++;
    } else logger.warn("keeper-reconciliation-failed", { wallet: [...wallets.keys()][index],
      reason: result.reason instanceof Error ? result.reason.message : "unknown" });
  });
  return completed;
}
