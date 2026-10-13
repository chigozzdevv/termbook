import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { monadClient } from "./monad.client.js";
import { requestLimiter } from "../http/http-limit.js";

const address = z.string().regex(/^0x[\da-fA-F]{40}$/), hash = z.string().regex(/^0x[\da-fA-F]{64}$/);
const hex = z.string().regex(/^0x[\da-fA-F]*$/).max(32768);
const quantity = z.string().regex(/^0x[\da-fA-F]{1,64}$/);
const block = z.union([quantity, z.enum(["latest", "pending", "earliest", "safe", "finalized"])]);
const call = z.object({ to: address, from: address.optional(), data: hex.optional(), gas: quantity.optional(), value: quantity.optional() }).strict()
  .refine((value) => value.gas === undefined || /^0x[\da-fA-F]{1,64}$/.test(value.gas) && BigInt(value.gas) <= 10_000_000n);
const logs = z.object({ address: z.union([address, z.array(address).min(1).max(20)]), blockHash: hash.optional(),
  fromBlock: block.optional(), toBlock: block.optional(),
  topics: z.array(z.union([hash, z.array(hash).max(20), z.null()])).max(4).optional() }).strict().refine((filter) => {
    if (filter.blockHash) return !filter.fromBlock && !filter.toBlock;
    const from = filter.fromBlock ?? "latest", to = filter.toBlock ?? "latest";
    if (/^0x[\da-fA-F]{1,64}$/.test(from) && /^0x[\da-fA-F]{1,64}$/.test(to)) return BigInt(to) >= BigInt(from) && BigInt(to) - BigInt(from) <= 1000n;
    return from === to && ["latest", "safe", "finalized"].includes(from);
  });
const schemas: Record<string, z.ZodType> = {
  eth_chainId: z.tuple([]), eth_blockNumber: z.tuple([]), net_version: z.tuple([]),
  eth_call: z.tuple([call, block]), eth_getCode: z.tuple([address, block]),
  eth_getStorageAt: z.tuple([address, quantity, block]), eth_getBalance: z.tuple([address, block]),
  eth_getTransactionCount: z.tuple([address, block]), eth_getTransactionReceipt: z.tuple([hash]), eth_getTransactionByHash: z.tuple([hash]),
  eth_getBlockByNumber: z.tuple([block, z.literal(false)]), eth_getBlockByHash: z.tuple([hash, z.literal(false)]),
  eth_getLogs: z.tuple([logs]),
};
const requestSchema = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.number().int(), z.string().max(64)]),
  method: z.string().max(64), params: z.array(z.unknown()).max(3).default([]) }).strict();

export function rpcRoute(app: FastifyInstance) {
  const limit = requestLimiter(240, 60_000), globalLimit = requestLimiter(480, 60_000);
  app.post("/rpc", { bodyLimit: 65536 }, async (req, reply) => {
    const parsed = z.union([requestSchema, z.array(requestSchema).min(1).max(8)]).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
    const batch = Array.isArray(parsed.data), requests = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    if (requests.some(() => !limit(req.ip) || !globalLimit("rpc"))) return reply.status(429).header("retry-after", "1").send({ error: "rpc-rate-limited" });
    const results = await Promise.all(requests.map(async (request) => {
      const schema = schemas[request.method], params = schema?.safeParse(request.params);
      if (!schema || !params?.success) return { jsonrpc: "2.0", id: request.id,
        error: { code: schema ? -32602 : -32601, message: schema ? "Invalid params" : "Method not supported" } };
      try {
        const values = params.data as unknown[];
        if (request.method === "eth_call") values[0] = { ...values[0] as object, gas: (values[0] as { gas?: string }).gas ?? "0x989680" };
        const result = await monadClient().request({ method: request.method, params: values } as never);
        return { jsonrpc: "2.0", id: request.id, result };
      } catch (error) {
        for (let cause = error as { code?: number; data?: unknown; cause?: unknown }; cause; cause = cause.cause as typeof cause) {
          if (cause.code === 3 && typeof cause.data === "string" && /^0x[\da-fA-F]*$/.test(cause.data) && cause.data.length <= 32768)
            return { jsonrpc: "2.0", id: request.id, error: { code: 3, message: "Execution reverted", data: cause.data } };
        }
        return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "RPC temporarily unavailable" } };
      }
    }));
    return batch ? results : results[0];
  });
}
