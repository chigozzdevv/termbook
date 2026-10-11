import type { HypersyncClient, Log as EnvioLog } from "@envio-dev/hypersync-client";
import type { Address, Hex, PublicClient } from "viem";
import { env } from "../config/env.js";

export type CoreLog = {
  address: Address; blockNumber: bigint; blockHash: Hex; transactionHash: Hex;
  logIndex: number; removed: boolean; data: Hex; topics: [Hex, ...Hex[]];
};
export type EventBatch = { logs: CoreLog[]; nextBlock: bigint; source: "rpc" | "envio" };
let cached: { key: string; client: HypersyncClient } | undefined;

export function assertEnvioConfig(): void {
  if (!env.envioApiToken && !env.envioUrl) return;
  if (!env.envioApiToken || env.envioApiToken.length > 4096 || /\s/.test(env.envioApiToken)
    || Array.from(env.envioApiToken).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error("envio-token-invalid");
  }
  let url: URL;
  try { url = new URL(env.envioUrl || `https://${env.monadChainId}.hypersync.xyz`); }
  catch { throw new Error("envio-url-invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("envio-url-invalid");
  }
}

export async function hypersync(): Promise<HypersyncClient> {
  assertEnvioConfig();
  const url = env.envioUrl || `https://${env.monadChainId}.hypersync.xyz`;
  const key = `${env.monadChainId}:${url}:${env.envioApiToken}`;
  if (cached?.key === key) return cached.client;
  const { HypersyncClient } = await import("@envio-dev/hypersync-client");
  const client = new HypersyncClient({ url, apiToken: env.envioApiToken, httpReqTimeoutMillis: 15_000,
    maxNumRetries: 1, retryCeilingMs: 1000 });
  cached = { key, client };
  return client;
}

function normalize(log: EnvioLog, from: bigint, next: bigint): CoreLog {
  const topics: Hex[] = [];
  let ended = false;
  for (const topic of log.topics) {
    if (topic === null || topic === undefined) { ended = true; continue; }
    if (ended || !/^0x[0-9a-fA-F]{64}$/.test(topic)) throw new Error("envio-log-invalid");
    topics.push(topic as Hex);
  }
  if (!Number.isSafeInteger(log.blockNumber) || log.blockNumber! < 0
    || BigInt(log.blockNumber!) < from || BigInt(log.blockNumber!) >= next
    || !Number.isSafeInteger(log.logIndex) || log.logIndex! < 0 || log.removed
    || log.address?.toLowerCase() !== env.core.toLowerCase()
    || !/^0x[0-9a-fA-F]{64}$/.test(log.blockHash ?? "")
    || !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash ?? "")
    || !/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data ?? "") || topics.length < 1 || topics.length > 4) {
    throw new Error("envio-log-invalid");
  }
  return { address: log.address as Address, blockNumber: BigInt(log.blockNumber!), blockHash: log.blockHash as Hex,
    transactionHash: log.transactionHash as Hex, logIndex: log.logIndex!, removed: false,
    data: log.data as Hex, topics: topics as [Hex, ...Hex[]] };
}

async function verifyReceipts(chain: PublicClient, logs: CoreLog[]): Promise<void> {
  const groups = new Map<Hex, CoreLog[]>();
  for (const log of logs) groups.set(log.transactionHash, [...(groups.get(log.transactionHash) ?? []), log]);
  const transactions = [...groups];
  for (let offset = 0; offset < transactions.length; offset += 4) await Promise.all(transactions.slice(offset, offset + 4).map(async ([hash, entries]) => {
    const receipt = await chain.getTransactionReceipt({ hash });
    const expected = receipt.logs.filter((log) => log.address.toLowerCase() === env.core.toLowerCase());
    if (receipt.status !== "success" || expected.length !== entries.length || entries.some((entry) => {
      const actual = expected.find((log) => log.logIndex === entry.logIndex);
      return receipt.blockNumber !== entry.blockNumber || receipt.blockHash.toLowerCase() !== entry.blockHash.toLowerCase()
        || !actual || actual.transactionHash.toLowerCase() !== hash.toLowerCase() || actual.data.toLowerCase() !== entry.data.toLowerCase()
        || actual.topics.length !== entry.topics.length || actual.topics.some((topic, index) => topic.toLowerCase() !== entry.topics[index]!.toLowerCase());
    })) throw new Error("envio-receipt-mismatch");
  }));
}

async function jsonPage(from: bigint, end: bigint): Promise<{ nextBlock: number; data: { logs: EnvioLog[] } }> {
  const url = env.envioUrl || `https://${env.monadChainId}.hypersync.xyz`;
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, { method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${env.envioApiToken}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("envio-query-unavailable");
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("envio-page-invalid");
    return value as Record<string, unknown>;
  };
  let chainId: unknown, page;
  try {
    chainId = (await request("/chain_id")).chain_id;
    if (chainId !== env.monadChainId) throw new Error("envio-chain-mismatch");
    page = await request("/query", { from_block: Number(from), to_block: Number(end),
      logs: [{ address: [env.core] }], max_num_logs: 1000,
      field_selection: { log: ["address", "block_number", "block_hash", "transaction_hash", "log_index", "data", "removed", "topic0", "topic1", "topic2", "topic3"] } });
  } catch {
    if (chainId !== undefined && chainId !== env.monadChainId) throw new Error("envio-chain-mismatch");
    throw new Error("envio-query-unavailable");
  }
  if (typeof page.next_block !== "number" || !Array.isArray(page.data) || page.data.length > 10_000
    || page.data.some((batch: { logs?: unknown }) => !batch || !Array.isArray(batch.logs))) throw new Error("envio-page-invalid");
  const logs = page.data.flatMap((batch: { logs: Record<string, unknown>[] }) => batch.logs);
  if (logs.length > 10_000 || logs.some((log: unknown) => !log || typeof log !== "object")) throw new Error("envio-page-invalid");
  return { nextBlock: page.next_block, data: { logs: logs.map((log: Record<string, unknown>) => ({
    address: log.address, blockNumber: log.block_number, blockHash: log.block_hash, transactionHash: log.transaction_hash,
    logIndex: log.log_index, data: log.data, removed: log.removed, topics: [log.topic0, log.topic1, log.topic2, log.topic3],
  })) as EnvioLog[] } };
}

export async function readCoreEvents(chain: PublicClient, from: bigint, finalized: bigint, transport: "native" | "json" = "native"): Promise<EventBatch> {
  if (from < 0n || finalized < from || finalized >= BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("indexer-range-invalid");
  assertEnvioConfig();
  if (!env.envioApiToken) {
    const to = from + 499n < finalized ? from + 499n : finalized;
    const ranges = Array.from({ length: Number((to - from) / 100n) + 1 }, (_, index) => {
      const fromBlock = from + BigInt(index) * 100n;
      return { fromBlock, toBlock: fromBlock + 99n < to ? fromBlock + 99n : to };
    });
    const logs = (await Promise.all(ranges.map((range) => chain.getLogs({ address: env.core as Address, ...range })))).flat();
    return { logs: logs as CoreLog[], nextBlock: to + 1n, source: "rpc" };
  }
  const end = from + 100_000n < finalized + 1n ? from + 100_000n : finalized + 1n;
  let response;
  if (transport === "json") response = await jsonPage(from, end);
  else {
    const client = await hypersync();
    if (await client.getChainId() !== env.monadChainId) throw new Error("envio-chain-mismatch");
    try {
      response = await client.get({ fromBlock: Number(from), toBlock: Number(end), logs: [{ address: [env.core] }],
        fieldSelection: { log: ["Address", "BlockNumber", "BlockHash", "TransactionHash", "LogIndex", "Data", "Removed", "Topic0", "Topic1", "Topic2", "Topic3"] },
        maxNumLogs: 1000 });
    } catch { throw new Error("envio-query-unavailable"); }
  }
  if (!Number.isSafeInteger(response.nextBlock) || BigInt(response.nextBlock) < from || BigInt(response.nextBlock) > end
    || !Array.isArray(response.data.logs) || response.data.logs.length > 10_000) throw new Error("envio-page-invalid");
  const nextBlock = BigInt(response.nextBlock);
  const logs = response.data.logs.map((log) => normalize(log, from, nextBlock))
    .sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex);
  if (new Set(logs.map((log) => `${log.blockNumber}:${log.logIndex}`)).size !== logs.length) throw new Error("envio-log-duplicate");
  await verifyReceipts(chain, logs);
  return { logs, nextBlock, source: "envio" };
}
