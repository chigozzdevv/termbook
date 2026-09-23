export const env = {
  port: Number(process.env["PORT"] ?? 3001),
  mongoUrl: process.env["MONGO_URL"] ?? "mongodb://127.0.0.1:27017/termbook",
  redisUrl: process.env["REDIS_URL"] ?? "",
  rpcUrl: process.env["RPC_URL"] ?? "http://127.0.0.1:8545",
  sourceProofUrl: process.env["SOURCE_PROOF_URL"] ?? "",
  settlementFactory: process.env["SETTLEMENT_FACTORY"] ?? "",
  auroraApiKey: process.env["AURORA_API_KEY"] ?? "",
  auroraRoutes: process.env["AURORA_ROUTES"] ?? "",
  settlementKeeperKey: process.env["SETTLEMENT_KEEPER_KEY"] ?? "",
  monadChainId: Number(process.env["MONAD_CHAIN_ID"] ?? 0),
  core: process.env["CORE_ADDRESS"] ?? "0x0000000000000000000000000000000000000000",
  coreDomain: process.env["CORE_DOMAIN"] ?? "",
  authDomain: process.env["AUTH_DOMAIN"] ?? "api.termbook.local",
  authTtlSeconds: Number(process.env["AUTH_TTL_SECONDS"] ?? 900),
  adminWallets: (process.env["ADMIN_WALLETS"] ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
};

export function assertRuntimeConfig(): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(env.core) || /^0x0{40}$/.test(env.core)) throw new Error("CORE_ADDRESS is required");
  if (!Number.isSafeInteger(env.port) || env.port <= 0 || !Number.isSafeInteger(env.authTtlSeconds) || env.authTtlSeconds <= 0) throw new Error("server-config-invalid");
  if (!Number.isSafeInteger(env.monadChainId) || env.monadChainId <= 0 || !/^0x[a-fA-F0-9]{64}$/.test(env.coreDomain)) {
    throw new Error("server-chain-config-invalid");
  }
  if (env.sourceProofUrl) {
    let proofUrl: URL;
    try {
      proofUrl = new URL(env.sourceProofUrl);
    } catch {
      throw new Error("SOURCE_PROOF_URL is invalid");
    }
    if (proofUrl.protocol !== "http:" && proofUrl.protocol !== "https:") throw new Error("SOURCE_PROOF_URL is invalid");
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
}

export function assertSettlementWorkerConfig(): void {
  if (env.auroraRoutes && !env.settlementKeeperKey) throw new Error("SETTLEMENT_KEEPER_KEY is required for admitted routes");
}
