import { createPublicClient, http, type PublicClient } from "viem";
import { env } from "../config/env.js";

export type ChainEvent = { name: string; block: number; tx: string; blockHash?: string; parentHash?: string; logIndex?: number; data: Record<string, unknown> };

let client: PublicClient | null = null;

export function monadClient(): PublicClient {
  if (!client) client = createPublicClient({ transport: http(env.rpcUrl) });
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
  const tip = await chainHeight().catch(() => from);
  for (let b = from; b < tip; b += step) {
    const to = b + step > tip ? tip : b + step;
    const logs = await monadClient()
      .getLogs({ address: env.core as `0x${string}`, fromBlock: b, toBlock: to })
      .catch(() => []);
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
