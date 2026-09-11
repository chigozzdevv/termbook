export const env = {
  port: Number(process.env["PORT"] ?? 3001),
  mongoUrl: process.env["MONGO_URL"] ?? "mongodb://127.0.0.1:27017/termbook",
  redisUrl: process.env["REDIS_URL"] ?? "",
  rpcUrl: process.env["RPC_URL"] ?? "http://127.0.0.1:8545",
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
}
