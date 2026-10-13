import { createPublicClient, http, parseAbi, type Address, type Abi } from "viem";
import { mainnet, sepolia, base, baseSepolia, monad, monadTestnet } from "viem/chains";
import { houseVaultAbi, termbookCoreAbi } from "@termbook/bindings";
import { collateralMarketSchema, explorerHouseSchema, explorerOrderSchema, type ExplorerHouse, type ExplorerOrder } from "@termbook/schema";
import { monadClient } from "../chain/monad.client.js";
import { evmSourceRpcUrl } from "../chain/networks.js";
import { env } from "../config/env.js";
import { houseRepo } from "../house/house.repo.js";
import { HttpError } from "../http/http.errors.js";
import { explorerRepo } from "./explorer.repo.js";

const chains = [mainnet, sepolia, base, baseSepolia, monad, monadTestnet];
const core = () => env.core as Address;
const zero = "0x0000000000000000000000000000000000000000";
const metadataAbi = parseAbi(["function symbol() view returns(string)", "function decimals() view returns(uint8)"]);
const registryAbi = parseAbi(["function houses(address) view returns(address vault,address asset,address manager,bool active)"]);
const facilities = ["reserved", "collateral_locking", "collateral_proving", "account_creating", "ready", "closing", "closed", "aborted", "liquidating", "recovery_pending", "liquidated"];
type Call = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };
type CreditDetails = { borrower: Address; house: Address; vault: Address; collateralVault: Address; collateralAsset: Address;
  collateralAmount: bigint; limit: bigint; maturity: bigint; aprBps: bigint; facility: number; revision: bigint };
const safeNumber = (value: unknown) => { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error("explorer-value-invalid"); return number; };
const label = (chainId: number) => chains.find((chain) => chain.id === chainId)?.name.replace("Testnet", "testnet") ?? `Chain ${chainId}`;
const configuredMarkets = () => collateralMarketSchema.array().parse(JSON.parse(env.collateralMarkets));

async function block() {
  const client = monadClient();
  if (await client.getChainId() !== env.monadChainId) throw new Error("explorer-chain-mismatch");
  return client.getBlock({ blockTag: "finalized" });
}
async function calls(requests: Call[], blockNumber: bigint): Promise<unknown[]> {
  const address = chains.find((chain) => chain.id === env.monadChainId)?.contracts?.multicall3?.address;
  if (!address) throw new Error("explorer-chain-unavailable");
  return monadClient().multicall({ contracts: requests, allowFailure: false, multicallAddress: address, blockNumber } as never) as Promise<unknown[]>;
}
function session(at: bigint) {
  const tokens = new Map<string, Promise<{ symbol: string; decimals: number }>>();
  return { at, async token(asset: Address, chainId = env.monadChainId) {
    if (asset === zero) return { symbol: chainId === 143 || chainId === 10143 ? "MON" : "ETH", decimals: 18 };
    const key = `${chainId}:${asset.toLowerCase()}`;
    if (!tokens.has(key)) tokens.set(key, (async () => {
      const client = chainId === env.monadChainId ? monadClient() : createPublicClient({ transport: http(evmSourceRpcUrl(chainId)) });
      if (await client.getChainId() !== chainId) throw new Error("explorer-chain-mismatch");
      const [symbol, decimals] = await Promise.all(["symbol", "decimals"].map((functionName) => client.readContract({
        address: asset, abi: metadataAbi, functionName, ...(chainId === env.monadChainId ? { blockNumber: at } : { blockTag: "finalized" }),
      } as never)));
      return { symbol: String(symbol), decimals: safeNumber(decimals) };
    })());
    return tokens.get(key)!;
  } };
}
type Session = ReturnType<typeof session>;
async function collateral(context: Session, chainId: number, asset: string, amount: string, genesis?: string): Promise<ExplorerOrder["collateral"]> {
  if (genesis) return { symbol: "SOL", amount, decimals: 9, asset, chain: { namespace: "solana", reference: genesis, chainId,
    label: env.monadChainId === 10143 ? "Solana devnet" : "Solana" } };
  const market = configuredMarkets().find((entry) => entry.kind === "evm" && entry.chainId === chainId && entry.asset.toLowerCase() === asset.toLowerCase());
  const token = market?.kind === "evm" && (market.nativeVault || market.wrapNative)
    ? { symbol: market.nativeVault ? "MON" : "ETH", decimals: market.decimals }
    : await context.token(asset as Address, chainId);
  return { ...token, asset, amount, chain: { namespace: "eip155", chainId, reference: String(chainId), label: label(chainId) } };
}

async function readHouse(row: Record<string, unknown>, context: Session): Promise<ExplorerHouse> {
  const [registry] = await calls([{ address: core(), abi: termbookCoreAbi, functionName: "houseRegistry" }], context.at);
  const [registered] = await calls([{ address: registry as Address, abi: registryAbi, functionName: "houses", args: [row.house] }], context.at);
  const [vault, asset, manager, active] = registered as [Address, Address, Address, boolean];
  if (vault.toLowerCase() !== String(row.vault).toLowerCase() || asset.toLowerCase() !== String(row.asset).toLowerCase()) throw new Error("explorer-house-mismatch");
  const fields = ["paused", "depositsOpen", "unresolvedCreditImpairment", "freeCash", "queuedWithdrawalAssets", "committedCash", "drawnPrincipal", "availableCash", "totalAssets", "totalShares", "sharePrice"];
  const values = await calls(fields.map((functionName) => ({ address: vault, abi: houseVaultAbi, functionName })), context.at);
  const state = Object.fromEntries(fields.map((field, index) => [field, typeof values[index] === "bigint" ? String(values[index]) : values[index]]));
  const token = await context.token(asset);
  return explorerHouseSchema.parse({ house: row.house, vault, asset, manager, active, ...state, assetSymbol: token.symbol, decimals: token.decimals });
}

async function readOrder(id: string, context: Session): Promise<ExplorerOrder | null> {
  const creation = await explorerRepo.creation(id);
  if (!creation) {
    const row = await explorerRepo.intent(id);
    if (!row) return null;
    const sol = row.collateral as { chain: { reference: string }; asset: { assetBytes: string }; amount: string } | undefined;
    const chainId = sol ? configuredMarkets().find((market) => market.kind === "solana" && market.genesis.toLowerCase() === sol.chain.reference.toLowerCase())?.chainId : Number(row.chainId);
    if (!chainId) throw new Error("explorer-collateral-unavailable");
    const token = await context.token(row.settlementAsset as Address);
    const [used] = await calls([{ address: core(), abi: termbookCoreAbi, functionName: "intentUsed", args: [id] }], context.at);
    return explorerOrderSchema.parse({ id, intentId: id, kind: "request", creditId: null, borrower: row.borrower, house: null,
      settlementAsset: row.settlementAsset, settlementSymbol: token.symbol, settlementDecimals: token.decimals,
      limit: row.limit ?? row.actionFunding, debt: null, aprBps: null, maturity: null, facility: null,
      status: used ? "used" : Number(row.expiresAt) <= Date.now() / 1000 ? "expired" : row.status,
      collateral: await collateral(context, chainId, sol?.asset.assetBytes ?? String(row.asset), sol?.amount ?? String(row.amount), sol?.chain.reference),
      duration: row.duration, createdAt: new Date(row.createdAt).toISOString(), expiresAt: row.expiresAt, events: [] });
  }
  const creditId = String(creation.creditId).toLowerCase();
  const [details, sourceChain, solana, debt] = await calls(["creditDetails", "collateralSourceChainOf", "solanaCollateral", "creditDebt"]
    .map((functionName) => ({ address: core(), abi: termbookCoreAbi, functionName, args: [creditId] })), context.at);
  const credit = details as CreditDetails;
  if (credit.revision === 0n) throw new Error("explorer-credit-mismatch");
  const events = await explorerRepo.events(creditId);
  if (events.length > 5000) throw new Error("explorer-event-limit");
  if (events.some((event) => BigInt(event.block) > context.at)) throw new Error("explorer-event-unfinalized");
  const createdBlock = await monadClient().getBlock({ blockNumber: BigInt(creation.block) });
  if (createdBlock.hash.toLowerCase() !== String(creation.blockHash).toLowerCase()) throw new Error("explorer-event-noncanonical");
  const [asset] = await calls([{ address: credit.vault, abi: houseVaultAbi, functionName: "asset" }], context.at);
  const token = await context.token(asset as Address);
  let collateralAsset: string = credit.collateralAsset, genesis: string | undefined;
  if (solana) {
    const [identity] = await calls([{ address: core(), abi: termbookCoreAbi, functionName: "solanaIdentityOf", args: [creditId] }], context.at);
    [genesis,, collateralAsset] = identity as string[];
  }
  return explorerOrderSchema.parse({ id: creditId, intentId: creation.data.intentId, kind: "credit", creditId,
    borrower: credit.borrower, house: credit.house, settlementAsset: asset,
    settlementSymbol: token.symbol, settlementDecimals: token.decimals, limit: String(credit.limit), debt: String(debt),
    aprBps: safeNumber(credit.aprBps), maturity: safeNumber(credit.maturity), facility: facilities[credit.facility] ?? "unknown",
    status: facilities[credit.facility] ?? "unknown", collateral: await collateral(context, safeNumber(sourceChain), collateralAsset, String(credit.collateralAmount), genesis),
    duration: safeNumber(credit.maturity > createdBlock.timestamp ? credit.maturity - createdBlock.timestamp : 0n),
    createdAt: new Date(safeNumber(createdBlock.timestamp) * 1000).toISOString(), expiresAt: null,
    events: events.map((event) => ({ event: event.event, blockNumber: safeNumber(event.block), transactionHash: event.txHash,
      logIndex: event.logIndex, args: { creditId } })).sort((left, right) => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex) });
}

const cache = new Map<string, { expires: number; data: Promise<unknown> }>();
async function cached<T>(key: string, read: () => Promise<T>): Promise<T> {
  key = `${env.monadChainId}:${env.core}:${key}`;
  const prior = cache.get(key);
  if (prior && prior.expires > Date.now()) return prior.data as Promise<T>;
  if (cache.size > 128) cache.clear();
  const entry = { expires: Infinity, data: read() };
  entry.data = entry.data.then((data) => { entry.expires = Date.now() + 15_000; return data; }).catch((error: unknown) => {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  });
  cache.set(key, entry);
  return entry.data;
}
async function indexed() {
  const cursor = await explorerRepo.cursor();
  if (!cursor || cursor.integrityFailure) throw new HttpError(503, "explorer-index-unavailable");
}
export const explorerService = {
  async houses() { return cached("houses", async () => {
    const at = await block(), context = session(at.number), rows = await houseRepo.list();
    if (rows.length > 100) throw new HttpError(503, "explorer-house-limit");
    return Promise.all(rows.map((row) => readHouse(row, context)));
  }); },
  async house(address: string) { return cached(`house:${address}`, async () => {
    const row = await houseRepo.get(address); if (!row) return null;
    return readHouse(row, session((await block()).number));
  }); },
  async orders(cursor?: string) { return cached(`orders:${cursor ?? ""}`, async () => {
    await indexed(); const at = await block(), context = session(at.number), page = await explorerRepo.orderPage(cursor);
    const records: ExplorerOrder[] = [];
    for (let offset = 0; offset < page.records.length; offset += 8) {
      const rows = await Promise.all(page.records.slice(offset, offset + 8).map((row) => readOrder(row.id, context)));
      if (rows.some((row) => !row)) throw new Error("explorer-record-missing");
      records.push(...rows as ExplorerOrder[]);
    }
    return { records, total: page.total, next: page.next, block: String(at.number) };
  }); },
  async order(id: string) { return cached(`order:${id}`, async () => { await indexed(); return readOrder(id, session((await block()).number)); }); },
};
