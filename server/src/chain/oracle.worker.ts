import { encodeFunctionData, keccak256, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { monadClient } from "./monad.client.js";
import { keeperTransaction } from "./keeper.js";
import { logger } from "../logging/logger.js";

const ratioAbi = parseAbi([
  "function oracle() view returns(address)", "function baseId() view returns(bytes32)",
  "function quoteId() view returns(bytes32)", "function baseRound() view returns(uint80)",
  "function quoteRound() view returns(uint80)", "function update() returns(uint80)",
]);
const oracleAbi = parseAbi(["function read(bytes32) view returns(uint256,uint256,uint80)"]);

export function ratioFeedConfig() {
  const raw = process.env["RATIO_PRICE_FEEDS"];
  const key = process.env["ORACLE_KEEPER_KEY"];
  if (!raw) return null;
  if (JSON.stringify(JSON.parse(raw)) === "[]") return null;
  if (!raw || !key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("oracle-keeper-config-invalid");
  const entries: unknown = JSON.parse(raw);
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 16) throw new Error("oracle-feeds-config-invalid");
  const feeds = entries.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("oracle-feeds-config-invalid");
    const { address, codeHash } = entry as Record<string, unknown>;
    if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/i.test(address)
      || typeof codeHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(codeHash) || /^0x0{64}$/i.test(codeHash)) throw new Error("oracle-feeds-config-invalid");
    return { address: address as Address, codeHash: codeHash as Hex };
  });
  if (new Set(feeds.map((feed) => feed.address.toLowerCase())).size !== feeds.length) throw new Error("oracle-feeds-config-invalid");
  if (Object.entries(process.env).some(([name, value]) => name !== "ORACLE_KEEPER_KEY"
    && /(?:KEEPER|RELAY)_KEY$/.test(name) && value?.toLowerCase() === key.toLowerCase())) throw new Error("oracle-keeper-key-conflict");
  return { feeds, account: privateKeyToAccount(key as Hex) };
}

export async function runOracleWorker(): Promise<number> {
  const config = ratioFeedConfig();
  if (!config) return 0;
  const client = monadClient(1);
  if (await client.getChainId() !== env.monadChainId) throw new Error("oracle-keeper-chain-mismatch");
  const finalized = await client.getBlock({ blockTag: "finalized" });
  let updated = 0;
  for (const feed of config.feeds) {
    try {
      const code = await client.getCode({ address: feed.address, blockNumber: finalized.number });
      if (!code || keccak256(code).toLowerCase() !== feed.codeHash.toLowerCase()) throw new Error("oracle-feed-code-mismatch");
      const read = (functionName: "oracle" | "baseId" | "quoteId" | "baseRound" | "quoteRound") =>
        client.readContract({ address: feed.address, abi: ratioAbi, functionName, blockNumber: finalized.number });
      const [oracle, baseId, quoteId, baseRound, quoteRound] = await Promise.all([
        read("oracle"), read("baseId"), read("quoteId"), read("baseRound"), read("quoteRound"),
      ]);
      const [base, quote] = await Promise.all([baseId, quoteId].map((id) => client.readContract({
        address: oracle as Address, abi: oracleAbi, functionName: "read", args: [id as Hex], blockNumber: finalized.number,
      })));
      if (base[2] === baseRound && quote[2] === quoteRound) continue;
      await client.simulateContract({ address: feed.address, abi: ratioAbi, functionName: "update", account: config.account.address });
      const result = await keeperTransaction({ client, rpcUrl: env.rpcUrl, chainId: env.monadChainId,
        account: config.account, operation: `oracle:${feed.address}:${base[2]}:${quote[2]}`, to: feed.address,
        data: encodeFunctionData({ abi: ratioAbi, functionName: "update" }) });
      if (result === "reverted") throw new Error("oracle-update-reverted");
      if (result === "success") updated++;
    } catch (cause) {
      logger.warn("oracle-update-unavailable", { feed: feed.address,
        reason: cause instanceof Error ? cause.message.match(/^(?:oracle|keeper)-[a-z-]+(?=:|$)/)?.[0]
          ?? "oracle-source-unavailable" : "oracle-source-unavailable" });
    }
  }
  return updated;
}
