import { houseService } from "../house/house.service.js";
import { integrationService } from "../integration/integration.service.js";
import { env } from "../config/env.js";
import { collateralMarketSchema, type CollateralMarket } from "@termbook/schema";
import { monadClient } from "../chain/monad.client.js";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { PublicKey } from "@solana/web3.js";
import { hexToBytes } from "viem";

const coreAbi = [
  { type: "function", name: "sourceCollateralVault", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "sourceRecoveryVault", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "solanaMarkets", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bool" },
  ] },
] as const;
const vaultAbi = [{ type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;

function configuredMarkets(): CollateralMarket[] {
  let value: unknown;
  try { value = JSON.parse(env.collateralMarkets); } catch { throw new Error("collateral-market-config-invalid"); }
  if (!Array.isArray(value) || value.length > 32) throw new Error("collateral-market-config-invalid");
  const markets = value.map((row) => collateralMarketSchema.parse(row));
  if (new Set(markets.map((market) => market.id)).size !== markets.length) throw new Error("collateral-market-config-invalid");
  for (const market of markets) {
    if (market.kind === "solana" && market.testnetUpgradeAuthority
      && (env.monadChainId !== 10143 || new PublicKey(hexToBytes(market.genesis as `0x${string}`)).toBase58()
        !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
        || market.testnetUpgradeAuthority !== process.env["SOLANA_TESTNET_UPGRADE_AUTHORITY"])) {
      throw new Error("collateral-market-config-invalid");
    }
    const url = new URL(market.rpcUrl);
    if (url.username || url.password || url.search || url.hash
      || url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      throw new Error("collateral-market-config-invalid");
    }
  }
  return markets;
}

async function admittedMarkets(): Promise<CollateralMarket[]> {
  const configured = configuredMarkets();
  if (configured.length === 0) return [];
  const chain = monadClient();
  const block = await chain.getBlock({ blockTag: "finalized" });
  const checks = await Promise.all(configured.map(async (market) => {
    if (market.kind === "solana") {
      const row = await chain.readContract({ address: env.core as `0x${string}`, abi: coreAbi,
        functionName: "solanaMarkets", args: [BigInt(market.chainId)], blockNumber: block.number });
      return market.asset.toLowerCase() === NATIVE_SOL_ASSET_BYTES.toLowerCase() && row[4]
        && row[0].toLowerCase() === market.genesis.toLowerCase()
        && row[1].toLowerCase() === market.program.toLowerCase()
        && row[2].toLowerCase() === market.asset.toLowerCase()
        && !/^0x0{64}$/i.test(row[3]);
    }
    if (market.chainId === env.monadChainId) {
      const [code, asset] = await Promise.all([
        chain.getBytecode({ address: market.vault as `0x${string}`, blockNumber: block.number }),
        chain.readContract({ address: market.vault as `0x${string}`, abi: vaultAbi, functionName: "asset", blockNumber: block.number }),
      ]);
      return !!code && code !== "0x" && asset.toLowerCase() === market.asset.toLowerCase();
    }
    const [vault, recovery] = await Promise.all([
      chain.readContract({ address: env.core as `0x${string}`, abi: coreAbi, functionName: "sourceCollateralVault",
        args: [BigInt(market.chainId), market.asset as `0x${string}`], blockNumber: block.number }),
      chain.readContract({ address: env.core as `0x${string}`, abi: coreAbi, functionName: "sourceRecoveryVault",
        args: [BigInt(market.chainId), market.asset as `0x${string}`], blockNumber: block.number }),
    ]);
    return vault.toLowerCase() === market.vault.toLowerCase() && !/^0x0{40}$/i.test(recovery);
  }));
  return configured.filter((_, index) => checks[index]);
}

export const catalogService = {
  async overview() {
    const [houses, integrations, collateralMarkets] = await Promise.all([
      houseService.list(),
      integrationService.list(),
      admittedMarkets(),
    ]);
    const assets = [...new Set(houses.map((house) => house.asset).filter((asset): asset is string => typeof asset === "string"))].map((asset) => ({ asset }));
    const chains = env.monadChainId > 0 ? [{ chainId: env.monadChainId }] : [];
    return { chains, assets, houses, integrations, collateralMarkets };
  },
};
