import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { z } from "zod";
import { encodeFunctionData, keccak256, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { monadClient } from "../chain/monad.client.js";
import { keeperTransaction, reconcileKeeperWallet } from "../chain/keeper.js";
import { logger } from "../logging/logger.js";

const configSchema = z.object({ keyFile: z.string().min(1), address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  depthWei: z.string().regex(/^[1-9]\d*$/).refine((v) => BigInt(v) <= 10n ** 19n),
  maxUpdatesPerDay: z.number().int().min(1).max(96), minimumGasWei: z.string().regex(/^[1-9]\d*$/),
}).strict();
const bookAbi = parseAbi([
  "function getMarketParams() view returns(uint32,uint96,address,uint256,address,uint256,uint32,uint96,uint96,uint256,uint256)",
  "function s_orderIdCounter() view returns(uint40)",
  "function s_orders(uint40) view returns(address,uint96,uint40,uint40,uint40,uint32,uint32,bool)",
  "function s_buyPricePoints(uint256) view returns(uint40,uint40)", "function s_sellPricePoints(uint256) view returns(uint40,uint40)",
  "function batchUpdate(uint32[],uint96[],uint32[],uint96[],uint40[],bool)",
]);
const balanceAbi = parseAbi(["function getBalance(address,address) view returns(uint256)"]);
const oracleAbi = parseAbi(["function read(bytes32) view returns(uint256,uint256,uint80)"]);
const registryAbi = parseAbi(["function isActive(bytes32) view returns(bool)"]);
const Model = mongoose.models["TermbookKuruLiquidity"] ?? mongoose.model("TermbookKuruLiquidity", new mongoose.Schema({
  _id: String, cursor: String, orderIds: [String], day: Number, updates: Number, pendingOperation: String,
}, { timestamps: true }));
type State = { cursor?: string; orderIds?: string[]; day?: number; updates?: number; pendingOperation?: string };
type Order = readonly [Address, bigint, number, number, number, number, number, boolean];

export function kuruLiquidityConfig() {
  const raw = process.env["TESTNET_KURU_LIQUIDITY"];
  if (!raw) return null;
  if (env.monadChainId !== 10143) throw new Error("kuru-liquidity-testnet-only");
  return configSchema.parse(JSON.parse(raw));
}

export function makerPrices(price: bigint, precision: bigint, tick: bigint) {
  if (price <= 0n || precision <= 0n || tick <= 0n) throw new Error("kuru-liquidity-price-invalid");
  const bid = price * precision * 9990n / 10n ** 18n / 10_000n / tick * tick;
  const ask = (price * precision * 10010n + 10n ** 22n * tick - 1n) / (10n ** 22n * tick) * tick;
  if (bid <= 0n || ask <= bid || ask >= 2n ** 32n) throw new Error("kuru-liquidity-price-invalid");
  return { bid, ask };
}

export function needsMakerUpdate(orders: { buy: boolean; price: bigint; size: bigint }[], price: bigint,
  precision: bigint, bidSize: bigint, askSize: bigint): boolean {
  for (const [buy, desired] of [[true, bidSize], [false, askSize]] as const) {
    const side = orders.filter((order) => order.buy === buy);
    if (side.some((order) => {
      const value = order.price * 10n ** 18n / precision;
      return (value > price ? value - price : price - value) * 10_000n > price * 20n;
    })) return true;
    const depth = side.reduce((sum, order) => sum + order.size, 0n);
    if (side.length > 1 || desired > depth && (desired - depth) * 5n >= desired || desired === 0n && depth > 0n) return true;
  }
  return false;
}

let active: Promise<number> | undefined;
export function runKuruLiquidityWorker(): Promise<number> {
  return active ??= maintain().finally(() => { active = undefined; });
}

async function maintain(): Promise<number> {
  const config = kuruLiquidityConfig();
  if (!config) return 0;
  try {
    const client = monadClient(1);
    if (await client.getChainId() !== 10143) throw new Error("kuru-liquidity-chain-mismatch");
    const deployment = JSON.parse(await readFile(new URL("../../../deployments/testnet.json", import.meta.url), "utf8"));
    const m = deployment.addresses?.[10143], installed = deployment.configuration?.["kuru-market"];
    const native = deployment.configuration?.native, integration = deployment.configuration?.["kuru-integration"];
    if (deployment.network !== "testnet" || m?.TermbookCore?.toLowerCase() !== env.core.toLowerCase()
      || installed?.core?.toLowerCase() !== env.core.toLowerCase() || !native?.priceId || !integration?.bundleId) throw new Error("kuru-liquidity-deployment-mismatch");
    const key = JSON.parse(await readFile(config.keyFile, "utf8"));
    const account = privateKeyToAccount(key.privateKey as Hex);
    if (account.address.toLowerCase() !== config.address.toLowerCase()) throw new Error("kuru-liquidity-signer-mismatch");
    const pending = await reconcileKeeperWallet(client, 10143, account.address);
    if (pending === "pending" || pending === "busy") return 0;
    const pin = installed.dependencies.find((item: { address: string }) => item.address.toLowerCase() === installed.market.toLowerCase());
    if (!pin) throw new Error("kuru-liquidity-pin-missing");
    const block = await client.getBlock({ blockTag: "finalized" }), blockNumber = block.number;
    const implementation = await client.getStorageAt({ address: installed.market, slot: pin.implementationSlot, blockNumber });
    if (implementation?.slice(-40).toLowerCase() !== pin.implementation.slice(2).toLowerCase()
      || !await client.readContract({ address: m.IntegrationRegistry, abi: registryAbi, functionName: "isActive", args: [integration.bundleId], blockNumber })) throw new Error("kuru-liquidity-integration-changed");
    const params = await client.readContract({ address: installed.market, abi: bookAbi, functionName: "getMarketParams", blockNumber });
    const [precision, scale, base, baseDecimals, quote, quoteDecimals, tick, minimum, maximum, makerFee] = params;
    if (base !== zeroAddress || baseDecimals !== 18n || quoteDecimals !== 6n || makerFee !== 0n
      || quote.toLowerCase() !== deployment.tokens[10143].USDC.toLowerCase()) throw new Error("kuru-liquidity-market-changed");
    const [price] = await client.readContract({ address: m.OracleRegistry, abi: oracleAbi, functionName: "read", args: [native.priceId], blockNumber });
    const { bid, ask } = makerPrices(price, BigInt(precision), BigInt(tick));
    const id = `${10143}:${installed.market.toLowerCase()}:${account.address.toLowerCase()}`;
    const state = (await Model.findById(id).lean() ?? {}) as State;
    const count = BigInt(await client.readContract({ address: installed.market, abi: bookAbi, functionName: "s_orderIdCounter", blockNumber }));
    const cursor = BigInt(state.cursor ?? "0");
    if (cursor > count) throw new Error("kuru-liquidity-counter-regressed");
    const through = count > cursor + 128n ? cursor + 128n : count;
    const ids = [...new Set([...(state.orderIds ?? []).map(BigInt), ...Array.from({ length: Number(through - cursor) }, (_, i) => cursor + BigInt(i) + 1n)])];
    const values = ids.length ? await client.multicall({ multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11", allowFailure: false, blockNumber,
      contracts: ids.map((order) => ({ address: installed.market, abi: bookAbi, functionName: "s_orders", args: [Number(order)] })) }) as unknown as Order[] : [];
    const owned = values.flatMap((order, i) => order[0].toLowerCase() === account.address.toLowerCase() && order[1] > 0n
      ? [{ id: ids[i]!, order }] : []);
    if (owned.length > 32) throw new Error("kuru-liquidity-order-capacity");
    const orders: { id: bigint; buy: boolean; price: bigint; size: bigint }[] = [];
    for (const { id: orderId, order } of owned) {
      const [head] = await client.readContract({ address: installed.market, abi: bookAbi, functionName: order[7] ? "s_buyPricePoints" : "s_sellPricePoints", args: [BigInt(order[5])], blockNumber });
      if (head > 0 && BigInt(head) <= orderId) orders.push({ id: orderId, buy: order[7], price: BigInt(order[5]), size: order[1] });
    }
    await Model.updateOne({ _id: id }, { $set: { cursor: String(through), orderIds: orders.map((order) => String(order.id)) } }, { upsert: true });
    if (through < count) return 0;
    const [freeBase, freeQuote] = await Promise.all([base, quote].map((asset) => client.readContract({ address: installed.margin, abi: balanceAbi,
      functionName: "getBalance", args: [account.address, asset], blockNumber })));
    const baseBalance = freeBase + orders.filter((order) => !order.buy).reduce((sum, order) => sum + order.size * 10n ** 18n / scale, 0n);
    const quoteBalance = freeQuote + orders.filter((order) => order.buy).reduce((sum, order) => sum + order.size * order.price / scale * 10n ** 6n / BigInt(precision), 0n);
    const target = BigInt(config.depthWei) * scale / 10n ** 18n;
    const bound = (quantity: bigint) => quantity < minimum ? 0n : quantity > maximum ? maximum : quantity;
    const bidSize = bound(target < quoteBalance * scale * BigInt(precision) / bid / 10n ** 6n ? target : quoteBalance * scale * BigInt(precision) / bid / 10n ** 6n);
    const askSize = bound(target < baseBalance * scale / 10n ** 18n ? target : baseBalance * scale / 10n ** 18n);
    if (!needsMakerUpdate(orders, price, BigInt(precision), bidSize, askSize)) return 0;
    const code = await client.getCode({ address: pin.implementation, blockNumber });
    if (!code || keccak256(code).toLowerCase() !== pin.implementationCodeHash.toLowerCase()) throw new Error("kuru-liquidity-implementation-changed");
    const day = Number(block.timestamp / 86400n), updates = state.day === day ? state.updates ?? 0 : 0;
    if (updates >= config.maxUpdatesPerDay) throw new Error("kuru-liquidity-budget-exhausted");
    if (await client.getBalance({ address: account.address }) < BigInt(config.minimumGasWei)) throw new Error("kuru-liquidity-gas-reserve");
    const args = [bidSize ? [Number(bid)] : [], bidSize ? [bidSize] : [], askSize ? [Number(ask)] : [], askSize ? [askSize] : [], orders.map((order) => Number(order.id)), true] as const;
    await client.simulateContract({ address: installed.market, abi: bookAbi, functionName: "batchUpdate", args, account: account.address });
    const operation = `kuru-liquidity:${installed.market}:${count}:${bid}:${ask}:${bidSize}:${askSize}`;
    const outcome = await keeperTransaction({ client, rpcUrl: env.rpcUrl, chainId: 10143, account, operation,
      to: installed.market, data: encodeFunctionData({ abi: bookAbi, functionName: "batchUpdate", args }), minimumBalance: BigInt(config.minimumGasWei) });
    if (outcome !== "busy") await Model.updateOne({ _id: id }, { $set: { day, updates: updates + (state.pendingOperation === operation ? 0 : 1), pendingOperation: operation } });
    if (outcome === "reverted") throw new Error("kuru-liquidity-update-reverted");
    if (outcome === "success") logger.info("kuru-liquidity-updated", { market: installed.market, bid: String(bid), ask: String(ask) });
    return outcome === "success" ? 1 : 0;
  } catch (error) {
    logger.warn("kuru-liquidity-unavailable", { reason: error instanceof Error ? error.message.match(/^kuru-liquidity-[a-z-]+$/)?.[0] ?? "kuru-liquidity-source-unavailable" : "kuru-liquidity-source-unavailable" });
    return 0;
  }
}
