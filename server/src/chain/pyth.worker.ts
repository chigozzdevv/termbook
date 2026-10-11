import { encodeFunctionData, keccak256 } from "viem";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { keeperTransaction } from "./keeper.js";
import { monadClient } from "./monad.client.js";
import { preparePythUpdates, pythAbi, pythOracleConfig, validPythPrice, type PythFeed } from "./pyth.client.js";

export async function runPythOracleWorker(): Promise<number> {
  const config = pythOracleConfig();
  if (!config) return 0;
  const client = monadClient(1);
  if (await client.getChainId() !== env.monadChainId) throw new Error("pyth-chain-mismatch");
  let updated = 0;
  for (const source of config.sources) {
    try {
      const block = await client.getBlock({ blockTag: "latest" });
      const code = await client.getCode({ address: source.address, blockNumber: block.number });
      if (!code || keccak256(code).toLowerCase() !== source.codeHash.toLowerCase()) throw new Error("pyth-source-code-mismatch");
      const stale: PythFeed[] = [];
      for (const feed of source.feeds) {
        const price = await client.readContract({ address: source.address, abi: pythAbi, functionName: "getPriceUnsafe", args: [feed.id], blockNumber: block.number }).catch(() => null);
        if (!price || !validPythPrice(price, feed, block.timestamp, feed.refreshAgeSeconds)) stale.push(feed);
      }
      if (!stale.length) continue;
      const { fee, updates, prices } = await preparePythUpdates(client, config, source, stale);
      const operation = `pyth:${source.address}:${prices.map((item) => `${item.id}:${item.price.publishTime}`).join(":")}`;
      const result = await keeperTransaction({ client, rpcUrl: env.rpcUrl, chainId: env.monadChainId, account: config.account,
        operation, to: source.address, data: encodeFunctionData({ abi: pythAbi, functionName: "updatePriceFeeds", args: [updates] }), value: fee });
      if (result === "reverted") throw new Error("pyth-update-reverted");
      if (result === "success") updated++;
    } catch (cause) {
      logger.warn("pyth-update-unavailable", { source: source.address, reason: cause instanceof Error
        ? cause.message.match(/^(?:pyth|keeper)-[a-z-]+(?=:|$)/)?.[0] ?? "pyth-proof-unavailable" : "pyth-proof-unavailable" });
    }
  }
  return updated;
}

export async function ensurePythPrices(): Promise<void> {
  const config = pythOracleConfig();
  if (!config) return;
  await runPythOracleWorker();
  const client = monadClient(1);
  if (await client.getChainId() !== env.monadChainId) throw new Error("pyth-chain-mismatch");
  const block = await client.getBlock({ blockTag: "finalized" });
  for (const source of config.sources) {
    const code = await client.getCode({ address: source.address, blockNumber: block.number });
    if (!code || keccak256(code).toLowerCase() !== source.codeHash.toLowerCase()) throw new Error("pyth-source-code-mismatch");
    for (const feed of source.feeds) {
      const price = await client.readContract({ address: source.address, abi: pythAbi, functionName: "getPriceUnsafe", args: [feed.id], blockNumber: block.number });
      if (!validPythPrice(price, feed, block.timestamp, feed.maxAgeSeconds)) throw new Error("pyth-price-unavailable");
    }
  }
}
