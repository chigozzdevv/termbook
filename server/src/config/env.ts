import { auroraProductionOrigin, validateAuroraApiKey, validateAuroraProvider } from "../settlement/aurora.provider.js";

export const env = {
  port: Number(process.env["PORT"] ?? 3001),
  mongoUrl: process.env["MONGO_URL"] ?? "mongodb://127.0.0.1:27017/termbook",
  redisUrl: process.env["REDIS_URL"] ?? "",
  rpcUrl: process.env["RPC_URL"] ?? "http://127.0.0.1:8545",
  envioApiToken: process.env["ENVIO_API_TOKEN"] ?? "",
  envioUrl: process.env["ENVIO_HYPERSYNC_URL"] ?? "",
  sourceRpcUrl: process.env["SOURCE_RPC_URL"] ?? "",
  sourceBeaconApiUrl: process.env["ETHEREUM_BEACON_API_URL"] ?? "",
  wormholeScanUrl: process.env["WORMHOLE_SCAN_URL"] ?? "",
  sourceWormholePublisherKey: process.env["SOURCE_WORMHOLE_PUBLISHER_KEY"] ?? "",
  monadWormholePublisherKey: process.env["MONAD_WORMHOLE_PUBLISHER_KEY"] ?? "",
  collateralKeeperKey: process.env["COLLATERAL_KEEPER_KEY"] ?? "",
  sourceActionKeeperKey: process.env["SOURCE_ACTION_KEEPER_KEY"] ?? "",
  monadConfirmKeeperKey: process.env["MONAD_CONFIRM_KEEPER_KEY"] ?? "",
  settlementFactory: process.env["SETTLEMENT_FACTORY"] ?? "",
  auroraApiKey: process.env["AURORA_API_KEY"] ?? "",
  auroraApiUrl: process.env["AURORA_API_URL"] ?? auroraProductionOrigin,
  auroraQuotePublicKey: process.env["AURORA_QUOTE_PUBLIC_KEY"] ?? "",
  auroraRoutes: process.env["AURORA_ROUTES"] ?? "",
  settlementKeeperKey: process.env["SETTLEMENT_KEEPER_KEY"] ?? "",
  monadChainId: Number(process.env["MONAD_CHAIN_ID"] ?? 0),
  core: process.env["CORE_ADDRESS"] ?? "0x0000000000000000000000000000000000000000",
  coreDomain: process.env["CORE_DOMAIN"] ?? "",
  publicApiBase: process.env["PUBLIC_API_BASE"] ?? "",
  publicRpcUrl: process.env["PUBLIC_RPC_URL"] ?? "",
  accountFactory: process.env["ACCOUNT_FACTORY_ADDRESS"] ?? "",
  collateralMarkets: process.env["COLLATERAL_MARKETS"] ?? "[]",
  authDomain: process.env["AUTH_DOMAIN"] ?? "api.termbook.local",
  authTtlSeconds: Number(process.env["AUTH_TTL_SECONDS"] ?? 900),
  adminWallets: (process.env["ADMIN_WALLETS"] ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
};

export function assertRuntimeConfig(): void {
  validateAuroraProvider({ apiUrl: env.auroraApiUrl, publicKey: env.auroraQuotePublicKey, chainId: env.monadChainId });
  if (env.auroraApiKey) validateAuroraApiKey(env.auroraApiKey);
  if (!/^0x[a-fA-F0-9]{40}$/.test(env.core) || /^0x0{40}$/.test(env.core)) throw new Error("CORE_ADDRESS is required");
  if (!Number.isSafeInteger(env.port) || env.port <= 0 || !Number.isSafeInteger(env.authTtlSeconds) || env.authTtlSeconds <= 0) throw new Error("server-config-invalid");
  if (!Number.isSafeInteger(env.monadChainId) || env.monadChainId <= 0 || !/^0x[a-fA-F0-9]{64}$/.test(env.coreDomain)) {
    throw new Error("server-chain-config-invalid");
  }
  for (const [name, value] of [
    ["SOURCE_RPC_URL", env.sourceRpcUrl],
    ["ETHEREUM_BEACON_API_URL", env.sourceBeaconApiUrl],
    ["WORMHOLE_SCAN_URL", env.wormholeScanUrl],
  ] as const) {
    if (!value) continue;
    let endpoint: URL;
    try {
      endpoint = new URL(value);
    } catch {
      throw new Error(`${name} is invalid`);
    }
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error(`${name} is invalid`);
  }
  if (env.collateralKeeperKey && !/^0x[a-fA-F0-9]{64}$/.test(env.collateralKeeperKey)) {
    throw new Error("COLLATERAL_KEEPER_KEY is invalid");
  }
  if (env.sourceWormholePublisherKey && !/^0x[a-fA-F0-9]{64}$/.test(env.sourceWormholePublisherKey)) {
    throw new Error("SOURCE_WORMHOLE_PUBLISHER_KEY is invalid");
  }
  if (env.monadWormholePublisherKey && !/^0x[a-fA-F0-9]{64}$/.test(env.monadWormholePublisherKey)) {
    throw new Error("MONAD_WORMHOLE_PUBLISHER_KEY is invalid");
  }
  if (env.sourceActionKeeperKey && !/^0x[a-fA-F0-9]{64}$/.test(env.sourceActionKeeperKey)) {
    throw new Error("SOURCE_ACTION_KEEPER_KEY is invalid");
  }
  if (env.monadConfirmKeeperKey && !/^0x[a-fA-F0-9]{64}$/.test(env.monadConfirmKeeperKey)) {
    throw new Error("MONAD_CONFIRM_KEEPER_KEY is invalid");
  }
  const ethereumProofConfigured = Boolean(env.sourceBeaconApiUrl
    || (env.wormholeScanUrl && env.sourceWormholePublisherKey));
  if (env.collateralKeeperKey && (!env.sourceRpcUrl || !ethereumProofConfigured)) {
    throw new Error("collateral-worker-config-incomplete");
  }
  if ([env.sourceActionKeeperKey, env.monadConfirmKeeperKey].some(Boolean)
    && (!env.sourceRpcUrl || !ethereumProofConfigured
      || !env.sourceActionKeeperKey || !env.monadConfirmKeeperKey)) {
    throw new Error("remote-action-worker-config-incomplete");
  }
  if (env.monadConfirmKeeperKey && [env.collateralKeeperKey, env.settlementKeeperKey]
    .some((key) => key && key.toLowerCase() === env.monadConfirmKeeperKey.toLowerCase())) {
    throw new Error("monad-confirm-keeper-key-conflict");
  }
  if (env.sourceActionKeeperKey && process.env["RECOVERY_FUNDING_KEY"]
    && env.sourceActionKeeperKey.toLowerCase() === process.env["RECOVERY_FUNDING_KEY"]!.toLowerCase()) {
    throw new Error("source-action-keeper-key-conflict");
  }
  if (env.sourceWormholePublisherKey && [env.collateralKeeperKey, env.sourceActionKeeperKey,
    process.env["RECOVERY_FUNDING_KEY"] ?? ""].some((key) => key
      && key.toLowerCase() === env.sourceWormholePublisherKey.toLowerCase())) {
    throw new Error("source-wormhole-publisher-key-conflict");
  }
  if (env.monadWormholePublisherKey && [env.collateralKeeperKey, env.monadConfirmKeeperKey,
    env.settlementKeeperKey].some((key) => key
      && key.toLowerCase() === env.monadWormholePublisherKey.toLowerCase())) {
    throw new Error("monad-wormhole-publisher-key-conflict");
  }
  if (env.auroraRoutes && (!/^0x[a-fA-F0-9]{40}$/.test(env.settlementFactory) || !env.auroraApiKey)) {
    throw new Error("aurora-config-invalid");
  }
  if (env.auroraRoutes) {
    try {
      if (!Array.isArray(JSON.parse(env.auroraRoutes))) throw new Error();
    } catch {
      throw new Error("aurora-routes-invalid");
    }
  }
  if (env.settlementKeeperKey && !/^0x[a-fA-F0-9]{64}$/.test(env.settlementKeeperKey)) throw new Error("settlement-keeper-config-invalid");
  const beaconConfig = ["ETHEREUM_LIGHT_CLIENT_ADDRESS", "ETHEREUM_BEACON_API_URL",
    "ETHEREUM_BEACON_KEEPER_KEY"] as const;
  const beaconValues = beaconConfig.map((name) => process.env[name] ?? "");
  if (beaconValues[0] || beaconValues[2]) {
    if (beaconValues.some((value) => !value) || env.monadChainId !== 143
      || !/^0x[a-fA-F0-9]{40}$/.test(beaconValues[0]!)
      || !/^0x[a-fA-F0-9]{64}$/.test(beaconValues[2]!)) {
      throw new Error("ethereum-beacon-worker-config-invalid");
    }
    for (const value of [beaconValues[1]!]) {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error("ethereum-beacon-worker-config-invalid"); }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("ethereum-beacon-worker-config-invalid");
      }
    }
    if ([env.collateralKeeperKey, env.monadConfirmKeeperKey, env.settlementKeeperKey,
      process.env["SOLANA_COLLATERAL_KEEPER_KEY"]].some((key) =>
      key && key.toLowerCase() === beaconValues[2]!.toLowerCase())) {
      throw new Error("ethereum-beacon-keeper-key-conflict");
    }
  }
}

export function assertSettlementWorkerConfig(): void {
  if (env.auroraRoutes && !env.settlementKeeperKey) throw new Error("SETTLEMENT_KEEPER_KEY is required for admitted routes");
}
