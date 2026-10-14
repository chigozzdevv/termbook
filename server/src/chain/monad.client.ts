import { createPublicClient, type PublicClient } from "viem";
import { env } from "../config/env.js";
import { pacedHttp } from "./rpc.transport.js";

export type ChainEvent = { name: string; block: number; tx: string; blockHash?: string; parentHash?: string; logIndex?: number; data: Record<string, unknown> };

const clients = new Map<number, PublicClient>();

export function monadClient(priority = 0): PublicClient {
  let client = clients.get(priority);
  if (!client) {
    const raw = createPublicClient({ transport: pacedHttp(env.rpcUrl, env.rpcRequestsPerSecond, priority, undefined,
      env.rpcFallbackUrl ? { url: env.rpcFallbackUrl, chainId: env.monadChainId } : undefined) });
    client = raw.extend(() => ({ multicall: async (input: Parameters<typeof raw.multicall>[0]) => {
      const result: unknown[] = [];
      // Viem measures batchSize in calldata bytes.
      for (let offset = 0; offset < input.contracts.length; offset += 32) {
        const values = await raw.multicall({ ...input, contracts: input.contracts.slice(offset, offset + 32), batchSize: 1024 } as never) as unknown[];
        result.push(...values);
      }
      return result;
    } })) as PublicClient;
    clients.set(priority, client);
  }
  return client;
}

export async function chainHeight(): Promise<bigint> {
  return monadClient().getBlockNumber();
}

export async function readCore(data: `0x${string}`): Promise<`0x${string}`> {
  const out = await monadClient().call({ to: env.core as `0x${string}`, data });
  return (out.data ?? "0x") as `0x${string}`;
}

export async function* streamEvents(from: bigint, step = 5000n): AsyncGenerator<ChainEvent> {
  if (from < 0n || step <= 0n || step > 5000n) throw new Error("event-range-invalid");
  const range = step > 100n ? 100n : step;
  const tip = (await monadClient().getBlock({ blockTag: "finalized" })).number;
  for (let b = from; b <= tip; b += range) {
    const to = b + range - 1n > tip ? tip : b + range - 1n;
    const logs = await monadClient()
      .getLogs({ address: env.core as `0x${string}`, fromBlock: b, toBlock: to });
    for (const l of logs) {
      yield {
        name: "log",
        block: Number(l.blockNumber),
        tx: l.transactionHash,
        blockHash: l.blockHash,
        logIndex: Number(l.logIndex),
        data: { topics: l.topics, data: l.data },
      };
    }
  }
}
