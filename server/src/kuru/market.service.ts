import { readFile } from "node:fs/promises";
import { decodeEventLog, toEventSelector, zeroAddress, type Address, type Hex } from "viem";
import { env } from "../config/env.js";
import { monadClient } from "../chain/monad.client.js";
import { hypersync } from "../chain/envio.client.js";
import { decimalRatio, decodeBook, marketAbi, tradeEvent } from "./market.js";

const marketAddress = /^0x[a-fA-F0-9]{40}$/;
const word = /^0x[a-fA-F0-9]{64}$/;
let deployment: Promise<{ address: Address; from: bigint; quote: Address; maximum: string }> | undefined;
function market() {
  return deployment ??= readFile(new URL("../../../deployments/testnet.json", import.meta.url), "utf8").then((raw) => {
    const saved = JSON.parse(raw);
    const config = saved.configuration;
    const definition = config?.["kuru-integration"]?.definition;
    const entry = definition?.markets?.[0];
    const from = saved.deploymentBlocks?.[String(env.monadChainId)];
    if (!/^\d+$/.test(String(from)) || env.monadChainId !== 10143 || definition?.chain_id !== env.monadChainId || !marketAddress.test(entry?.address)
      || !marketAddress.test(entry?.quote_asset) || entry?.base_asset !== zeroAddress) throw new Error("kuru-market-unavailable");
    return { address: entry.address as Address, quote: entry.quote_asset as Address,
      from: BigInt(from), maximum: definition.atomic_spot.maximum_input as string };
  });
}

let snapshot: { expires: number; data: unknown } | undefined;
let snapshotRequest: Promise<unknown> | undefined;
export async function marketSnapshot() {
  if (snapshot && snapshot.expires > Date.now()) return snapshot.data;
  if (snapshotRequest) return snapshotRequest;
  snapshotRequest = (async () => {
    const config = await market(), chain = monadClient();
    if (await chain.getChainId() !== env.monadChainId) throw new Error("kuru-market-unavailable");
    const block = await chain.getBlock({ blockTag: "finalized" });
    const [params, state, book] = await Promise.all([
      chain.readContract({ address: config.address, abi: marketAbi, functionName: "getMarketParams", blockNumber: block.number }),
      chain.readContract({ address: config.address, abi: marketAbi, functionName: "marketState", blockNumber: block.number }),
      chain.readContract({ address: config.address, abi: marketAbi, functionName: "getL2Book", args: [16, 16], blockNumber: block.number }),
    ]);
    const [price, size, base, baseDecimals, quote, quoteDecimals,,,, fee] = params;
    if (base !== zeroAddress || quote.toLowerCase() !== config.quote.toLowerCase() || baseDecimals !== 18n || quoteDecimals !== 6n
      || fee >= 10_000n) throw new Error("kuru-market-unavailable");
    const token = process.env["TERMBOOK_KURU_APP_TOKEN"];
    const data = { chain_id: env.monadChainId, market_id: config.address.toLowerCase(), address: config.address,
      base_asset: base, quote_asset: quote, base_decimals: Number(baseDecimals), quote_decimals: Number(quoteDecimals),
      block: String(block.number), timestamp: Number(block.timestamp), state, fee_bps: Number(fee),
      maximum_buy: decimalRatio(BigInt(config.maximum), 10n ** quoteDecimals),
      app_token: /^tbk_[a-f0-9]{64}$/.test(token ?? "") ? token : null,
      ...decodeBook(book, block.number, BigInt(price), size) };
    snapshot = { data, expires: Date.now() + 3000 };
    return data;
  })().finally(() => { snapshotRequest = undefined; });
  return snapshotRequest;
}

export type MarketTrade = { id: string; tx: Hex; block: string; time: number; direction: "buy" | "sell"; price: string; size: string };
let history: { expires: number; data: { trades: MarketTrade[]; through: string } } | undefined;
let historyRequest: Promise<{ trades: MarketTrade[]; through: string }> | undefined;
export async function marketHistory() {
  if (history && history.expires > Date.now()) return history.data;
  if (historyRequest) return historyRequest;
  historyRequest = (async () => {
    const config = await market(), chain = monadClient();
    const finalized = await chain.getBlock({ blockTag: "finalized" });
    const params = await chain.readContract({ address: config.address, abi: marketAbi, functionName: "getMarketParams", blockNumber: finalized.number });
    const logs: { data: Hex; topics: [Hex, ...Hex[]]; block: bigint; tx: Hex; index: number; time: number }[] = [];
    if (env.envioApiToken) {
      const archive = await hypersync();
      if (await archive.getChainId() !== env.monadChainId) throw new Error("kuru-history-unavailable");
      let from = config.from > finalized.number - 500_000n ? config.from : finalized.number - 500_000n;
      for (let page = 0; page < 8 && from <= finalized.number; page++) {
        const response = await archive.get({ fromBlock: Number(from), toBlock: Number(finalized.number + 1n),
          logs: [{ address: [config.address], topics: [[toEventSelector(tradeEvent)]] }],
          fieldSelection: { block: ["Number", "Hash", "Timestamp"], log: ["Address", "BlockNumber", "BlockHash", "TransactionHash", "LogIndex", "Data", "Topic0"] }, maxNumLogs: 500 });
        if (!Number.isSafeInteger(response.nextBlock) || BigInt(response.nextBlock) <= from || BigInt(response.nextBlock) > finalized.number + 1n) throw new Error("kuru-history-unavailable");
        const blocks = new Map(response.data.blocks.map((block) => [block.number, block]));
        for (const log of response.data.logs) {
          const block = blocks.get(log.blockNumber);
          if (log.address?.toLowerCase() !== config.address.toLowerCase() || !block || log.blockHash !== block.hash
            || !Number.isSafeInteger(block.timestamp) || !Number.isSafeInteger(log.logIndex) || !word.test(log.transactionHash ?? "")
            || !/^0x(?:[a-fA-F0-9]{2})*$/.test(log.data ?? "") || log.topics[0] !== toEventSelector(tradeEvent)) throw new Error("kuru-history-unavailable");
          logs.push({ data: log.data as Hex, topics: [log.topics[0] as Hex], block: BigInt(log.blockNumber!),
            tx: log.transactionHash as Hex, index: log.logIndex!, time: block.timestamp! });
        }
        from = BigInt(response.nextBlock);
      }
      if (from <= finalized.number) throw new Error("kuru-history-unavailable");
    } else {
      const fromBlock = finalized.number > 99n ? finalized.number - 99n : 0n;
      const events = await chain.getLogs({ address: config.address, event: tradeEvent, fromBlock, toBlock: finalized.number, strict: true });
      const blocks = new Map<bigint, number>();
      for (const event of events) {
        if (!blocks.has(event.blockNumber)) blocks.set(event.blockNumber, Number((await chain.getBlock({ blockNumber: event.blockNumber })).timestamp));
        logs.push({ data: event.data, topics: event.topics as [Hex, ...Hex[]], block: event.blockNumber,
          tx: event.transactionHash, index: event.logIndex, time: blocks.get(event.blockNumber)! });
      }
    }
    logs.sort((a, b) => a.block < b.block ? -1 : a.block > b.block ? 1 : a.index - b.index);
    const seen = new Set<string>();
    const trades = logs.map((log): MarketTrade => {
      const id = `${log.tx}:${log.index}`;
      if (seen.has(id)) throw new Error("kuru-history-unavailable");
      seen.add(id);
      const event = decodeEventLog({ abi: [tradeEvent], data: log.data, topics: log.topics, strict: true });
      return { id, tx: log.tx, block: String(log.block), time: log.time,
        direction: event.args.isBuy ? "buy" : "sell", price: decimalRatio(event.args.price, 10n ** 18n), size: decimalRatio(event.args.filledSize, params[1]) };
    }).filter((trade) => Number(trade.size) > 0);
    const data = { trades: trades.slice(-2000), through: String(finalized.number) };
    history = { data, expires: Date.now() + 15_000 };
    return data;
  })().finally(() => { historyRequest = undefined; });
  return historyRequest;
}
