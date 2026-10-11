import { keccak256, parseAbi, type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const pythAbi = parseAbi([
  "function getPriceUnsafe(bytes32) view returns((int64 price,uint64 conf,int32 expo,uint256 publishTime))",
  "function getUpdateFee(bytes[]) view returns(uint256)",
  "function updatePriceFeeds(bytes[]) payable",
  "function parsePriceFeedUpdates(bytes[],bytes32[],uint64,uint64) payable returns((bytes32 id,(int64 price,uint64 conf,int32 expo,uint256 publishTime) price,(int64 price,uint64 conf,int32 expo,uint256 publishTime) emaPrice)[])",
]);
export type PythFeed = { id: Hex; maxAgeSeconds: number; refreshAgeSeconds: number; maxConfidenceBps: number };
export type PythSource = { address: Address; codeHash: Hex; maximumUpdateFee: bigint; feeds: PythFeed[] };
export type PythConfig = { sources: PythSource[]; account: LocalAccount; endpoint: string; apiKey: string };

export function pythEndpoint(value = process.env["PYTH_HERMES_URL"] ?? "https://hermes.pyth.network"): string {
  let endpoint: URL;
  try { endpoint = new URL(value); } catch { throw new Error("pyth-endpoint-invalid"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== "/" && endpoint.pathname !== "/hermes") throw new Error("pyth-endpoint-invalid");
  return endpoint.href.replace(/\/$/, "");
}

export function validPythPrice(price: { price: bigint; conf: bigint; expo: number; publishTime: bigint }, feed: PythFeed, now: bigint, age: number): boolean {
  return price.price > 0n && price.expo >= -36 && price.expo <= 18 && price.publishTime > 0n
    && price.publishTime <= now && now - price.publishTime <= BigInt(age)
    && price.conf * 10_000n <= price.price * BigInt(feed.maxConfidenceBps);
}

export async function preparePythUpdates(client: PublicClient, config: PythConfig, source: PythSource, feeds = source.feeds) {
  if (!feeds.length || new Set(feeds.map((feed) => feed.id.toLowerCase())).size !== feeds.length
    || feeds.some((feed) => !source.feeds.some((expected) => expected.id.toLowerCase() === feed.id.toLowerCase()
      && expected.maxAgeSeconds === feed.maxAgeSeconds && expected.refreshAgeSeconds === feed.refreshAgeSeconds
      && expected.maxConfidenceBps === feed.maxConfidenceBps))) throw new Error("pyth-feeds-invalid");
  const block = await client.getBlock({ blockTag: "latest" });
  const code = await client.getCode({ address: source.address, blockNumber: block.number });
  if (!code || keccak256(code).toLowerCase() !== source.codeHash.toLowerCase()) throw new Error("pyth-source-code-mismatch");
  const ids = feeds.map((feed) => feed.id);
  const updates = await fetchPythUpdates(config, ids);
  const fee = await client.readContract({ address: source.address, abi: pythAbi, functionName: "getUpdateFee", args: [updates] });
  if (fee > source.maximumUpdateFee) throw new Error("pyth-update-fee-exceeded");
  const current = await client.getBlock({ blockTag: "latest" });
  const age = Math.min(...feeds.map((feed) => feed.refreshAgeSeconds));
  const proof = await client.simulateContract({ address: source.address, abi: pythAbi, functionName: "parsePriceFeedUpdates",
    args: [updates, ids, current.timestamp - BigInt(age), current.timestamp], value: fee, account: config.account.address });
  if (proof.result.length !== ids.length || proof.result.some((item, index) => item.id.toLowerCase() !== ids[index]!.toLowerCase()
    || !validPythPrice(item.price, feeds[index]!, current.timestamp, feeds[index]!.refreshAgeSeconds))) throw new Error("pyth-proof-invalid");
  await client.simulateContract({ address: source.address, abi: pythAbi, functionName: "updatePriceFeeds", args: [updates], value: fee, account: config.account.address });
  return { fee, updates, prices: proof.result };
}

export function pythOracleConfig(): PythConfig | null {
  const raw = process.env["PYTH_PRICE_FEEDS"];
  if (!raw) return null;
  let entries: unknown;
  try { entries = JSON.parse(raw); } catch { throw new Error("pyth-config-invalid"); }
  if (!Array.isArray(entries) || entries.length > 4) throw new Error("pyth-config-invalid");
  if (entries.length === 0) return null;
  const key = process.env["ORACLE_KEEPER_KEY"];
  const apiKey = process.env["PYTH_API_KEY"];
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key) || !apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new Error("pyth-config-invalid");
  if (Object.entries(process.env).some(([name, value]) => name !== "ORACLE_KEEPER_KEY"
    && /(?:KEEPER|RELAY)_KEY$/.test(name) && value?.toLowerCase() === key.toLowerCase())) throw new Error("pyth-keeper-key-conflict");
  const word = (value: unknown): value is Hex => typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value) && !/^0x0{64}$/i.test(value);
  const bounded = (value: unknown, maximum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
  const sources = entries.map((entry: unknown): PythSource => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("pyth-config-invalid");
    const { address, codeHash, maximumUpdateFee, feeds } = entry as Record<string, unknown>;
    if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address) || /^0x0{40}$/i.test(address)
      || !word(codeHash) || typeof maximumUpdateFee !== "string" || !/^\d{1,19}$/.test(maximumUpdateFee)
      || BigInt(maximumUpdateFee) === 0n || BigInt(maximumUpdateFee) > 10n ** 18n
      || !Array.isArray(feeds) || feeds.length === 0 || feeds.length > 32) throw new Error("pyth-config-invalid");
    const parsed = feeds.map((item: unknown): PythFeed => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("pyth-config-invalid");
      const { id, maxAgeSeconds, refreshAgeSeconds, maxConfidenceBps } = item as Record<string, unknown>;
      if (!word(id) || !bounded(maxAgeSeconds, 900) || !bounded(refreshAgeSeconds, 900)
        || refreshAgeSeconds >= maxAgeSeconds || !bounded(maxConfidenceBps, 1000)) throw new Error("pyth-config-invalid");
      return { id, maxAgeSeconds, refreshAgeSeconds, maxConfidenceBps };
    });
    if (new Set(parsed.map((item) => item.id.toLowerCase())).size !== parsed.length) throw new Error("pyth-config-invalid");
    return { address: address as Address, codeHash, maximumUpdateFee: BigInt(maximumUpdateFee), feeds: parsed };
  });
  if (sources.reduce((sum, source) => sum + source.feeds.length, 0) > 32
    || new Set(sources.map((source) => source.address.toLowerCase())).size !== sources.length) throw new Error("pyth-config-invalid");
  return { sources, account: privateKeyToAccount(key as Hex), endpoint: pythEndpoint(), apiKey };
}

export async function fetchPythUpdates(config: PythConfig, ids: Hex[]): Promise<Hex[]> {
  const url = new URL(`${config.endpoint}/v2/updates/price/latest`);
  for (const id of ids) url.searchParams.append("ids[]", id);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${config.apiKey}` },
    redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error("pyth-updates-unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 262_144) throw new Error("pyth-updates-invalid");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  let result: unknown;
  try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("pyth-updates-invalid"); }
  const binary = result && typeof result === "object" ? (result as Record<string, unknown>)["binary"] : null;
  if (!binary || typeof binary !== "object" || (binary as Record<string, unknown>)["encoding"] !== "hex") throw new Error("pyth-updates-invalid");
  const data = (binary as Record<string, unknown>)["data"];
  if (!Array.isArray(data) || data.length === 0 || data.length > 16) throw new Error("pyth-updates-invalid");
  const updates = data.map((item: unknown): Hex => {
    if (typeof item !== "string" || !/^(?:0x)?(?:[a-fA-F0-9]{2})+$/.test(item) || item.length > 65_538) throw new Error("pyth-updates-invalid");
    return `0x${item.replace(/^0x/, "")}`;
  });
  if (updates.reduce((sum, item) => sum + (item.length - 2) / 2, 0) > 131_072
    || new Set(updates.map((item) => keccak256(item))).size !== updates.length) throw new Error("pyth-updates-invalid");
  return updates;
}
