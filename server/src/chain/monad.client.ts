import { createPublicClient, type PublicClient } from "viem";
import { env } from "../config/env.js";
import { pacedHttp } from "./rpc.transport.js";

export type ChainEvent = { name: string; block: number; tx: string; blockHash?: string; parentHash?: string; logIndex?: number; data: Record<string, unknown> };

let client: PublicClient | null = null;

export function monadClient(): PublicClient {
  if (!client) client = createPublicClient({ transport: pacedHttp(env.rpcUrl) });
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
