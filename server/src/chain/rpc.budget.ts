import { createHash, randomUUID } from "node:crypto";
import type IORedis from "ioredis";
let shared: Promise<IORedis> | undefined;

export const rpcBudgetScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local cost, limit = tonumber(ARGV[1]), tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 1001)
local rows = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
local at = now
if #rows > 0 then at = math.max(at, tonumber(rows[#rows])) end
while true do
  local total, first = 0, nil
  for i = 1, #rows, 2 do
    local time = tonumber(rows[i + 1])
    if time > at - 1001 then
      total = total + tonumber(string.match(rows[i], '^(%d+):'))
      first = first or time
    end
  end
  if total + cost <= limit then break end
  at = first + 1001
  if at - now > 30000 then return -1 end
end
redis.call('ZADD', KEYS[1], at, tostring(cost) .. ':' .. ARGV[3])
redis.call('PEXPIRE', KEYS[1], 60000)
return at - now`;

const costs: Record<string, number> = { eth_chainId: 1, eth_gasPrice: 1, eth_blockNumber: 10,
  eth_feeHistory: 10, eth_getTransactionReceipt: 15, eth_getBlockByNumber: 16, eth_getTransactionByHash: 17,
  eth_getStorageAt: 17, eth_getBalance: 19, eth_getCode: 19, eth_getBlockByHash: 21,
  eth_call: 26, eth_getTransactionCount: 26, eth_getLogs: 75, eth_estimateGas: 80,
  eth_sendRawTransaction: 250, eth_fillTransaction: 250, eth_getBlockReceipts: 500 };

export async function reserveRpcBudget(url: string, method: string, params?: unknown): Promise<void> {
  if (!new URL(url).hostname.endsWith(".blockvision.org")) return;
  const limit = Number(process.env["RPC_COMPUTE_UNITS_PER_SECOND"] ?? 300);
  let cost = costs[method] ?? 26;
  const call = Array.isArray(params) ? params[0] as { to?: string; data?: string } : undefined;
  if (method === "eth_call" && call?.to?.toLowerCase() === "0xca11bde05977b3631167028862be2a173976ca11" && call.data?.startsWith("0x82ad56cb")) {
    const { decodeFunctionData, parseAbi } = await import("viem");
    const decoded = decodeFunctionData({ abi: parseAbi(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])"]), data: call.data as `0x${string}` });
    cost *= Math.max(1, decoded.args[0].length);
  }
  if (!Number.isSafeInteger(limit) || limit < 250 || limit > 1_000_000 || cost > limit) throw new Error("rpc-budget-invalid");
  const redisUrl = process.env["RPC_BUDGET_REDIS_URL"] || process.env["REDIS_URL"];
  if (!redisUrl) throw new Error("rpc-budget-storage-unavailable");
  const redis = await (shared ??= import("ioredis").then(({ default: Redis }) =>
    new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 5000 })));
  const key = `rpc:budget:${createHash("sha256").update(url).digest("hex")}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = await Promise.race([
    redis.eval(rpcBudgetScript, 1, key, cost, limit, randomUUID()),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("rpc-budget-unavailable")), 5000); }),
  ]).finally(() => clearTimeout(timer));
  if (typeof wait !== "number" || wait < 0 || wait > 30_000) throw new Error("rpc-queue-full");
  if (wait) await new Promise<void>((resolve) => setTimeout(resolve, wait));
}

export async function closeRpcBudget() {
  if (!shared) return;
  const redis = await shared;
  try { await redis.quit(); } finally { redis.disconnect(); shared = undefined; }
}
