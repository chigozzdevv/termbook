import { createHash } from "node:crypto";
import { decodeEventLog, type Address } from "viem";
import { canonicalJson } from "@termbook/schema";
import { termbookCoreAbi, testnetProxyAbi } from "@termbook/bindings";
import { monadClient } from "./monad.client.js";
import { indexerRepo } from "./indexer.repo.js";
import { creditService } from "../credit/credit.service.js";
import { queue } from "../queue/queue.client.js";
import { env } from "../config/env.js";
import { readCoreEvents } from "./envio.client.js";

const coreEventAbi = [...termbookCoreAbi,
  ...testnetProxyAbi.filter((entry) => entry.type === "event" && entry.name !== "Initialized")];

export function indexerStart(): bigint {
  const value = process.env["CORE_DEPLOYMENT_BLOCK"];
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("CORE_DEPLOYMENT_BLOCK is required");
  return BigInt(value);
}

export async function runIndexerWorker(start: bigint = indexerStart()): Promise<number> {
  if (start < 0n) throw new Error("indexer-range-invalid");
  const key = `${env.monadChainId}:${env.core.toLowerCase()}`;
  const cursor = await indexerRepo.claim(key, start);
  if (!cursor) return 0;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void indexerRepo.renew(key, cursor.lease).then((ok) => { if (!ok) leaseLost = true; })
      .catch(() => { leaseLost = true; });
  }, 30_000);
  try {
    const from = BigInt(cursor.nextBlock);
    if (from < start) throw new Error("indexer-checkpoint-invalid");
    const chain = monadClient();
    if (await chain.getChainId() !== env.monadChainId) throw new Error("indexer-chain-mismatch");
    if (cursor.lastBlockHash) {
      const previous = await chain.getBlock({ blockNumber: from - 1n });
      if (previous.hash !== cursor.lastBlockHash) {
        await indexerRepo.integrityFailure(key, cursor.lease);
        throw new Error("indexer-finalized-block-changed");
      }
    }
    const finalized = await chain.getBlock({ blockTag: "finalized" });
    if (from > finalized.number) {
      if (from === finalized.number + 1n && !leaseLost) {
        await indexerRepo.advance(key, cursor.lease, from, finalized.hash);
      }
      return 0;
    }
    const { logs, nextBlock } = await readCoreEvents(chain, from, finalized.number, "json");
    if (nextBlock === from) return 0;
    const to = nextBlock - 1n;
    const boundary = await chain.getBlock({ blockNumber: to });
    const headers = new Map<string, string>();
    for (const log of logs) {
      if (log.removed || log.blockNumber < from || log.blockNumber > to
        || !log.blockHash || !log.transactionHash) throw new Error("indexer-log-invalid");
      const number = log.blockNumber.toString();
      if (!headers.has(number)) headers.set(number, (await chain.getBlock({ blockNumber: log.blockNumber })).hash);
      if (headers.get(number) !== log.blockHash) throw new Error("indexer-log-not-canonical");
    }
    if ((await chain.getBlock({ blockNumber: to })).hash !== boundary.hash) throw new Error("indexer-finality-conflict");
    const credits = new Set<string>();
    for (const log of logs) {
      const decoded = decodeEventLog({ abi: coreEventAbi, data: log.data, topics: log.topics, strict: true });
      const args = decoded.args as Record<string, unknown>;
      const creditId = args["creditId"];
      const id = createHash("sha256").update(`${key}:${log.blockHash}:${log.logIndex}`).digest("hex");
      if (typeof creditId === "string" && /^0x[a-fA-F0-9]{64}$/.test(creditId)) credits.add(creditId.toLowerCase());
      await indexerRepo.record(id, { chainId: env.monadChainId, core: env.core.toLowerCase(),
        block: log.blockNumber.toString(), blockHash: log.blockHash, txHash: log.transactionHash,
        logIndex: log.logIndex, event: decoded.eventName, creditId,
        data: JSON.parse(canonicalJson(args)) as Record<string, unknown> });
      if (decoded.eventName === "RemoteActionAuthorized" && typeof creditId === "string") {
        const solana = await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
          functionName: "solanaCollateral", args: [creditId as `0x${string}`], blockNumber: to });
        const actionKind = Number(args["kind"]);
        if (actionKind === 0 || actionKind === 1 || actionKind === 2) {
          const actionHash = args["actionHash"];
          const current = actionKind === 2 ? (await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
            functionName: "pendingCollateralTopUp", args: [creditId as `0x${string}`], blockNumber: to }))[1] : await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
            functionName: actionKind === 0 ? "remoteReturnActionHash" : "remoteSeizureActionHash",
            args: [creditId as `0x${string}`], blockNumber: to });
          if (current === actionHash) await queue.push({ kind: solana ? "collateral.solana-authorized" : "collateral.remote-authorized",
            payload: { creditId, actionHash, kind: actionKind, authorizationTxHash: log.transactionHash } });
        }
      }
    }
    const ids = [...credits];
    for (let i = 0; i < ids.length; i += 8) {
      if (leaseLost) throw new Error("indexer-lease-lost");
      await Promise.all(ids.slice(i, i + 8).map(async (creditId) => {
        await creditService.refresh(creditId);
        await queue.push({ kind: "credit.tracked", payload: { creditId } });
      }));
    }
    if (leaseLost) throw new Error("indexer-lease-lost");
    await indexerRepo.advance(key, cursor.lease, nextBlock, boundary.hash);
    return logs.length;
  } finally {
    clearInterval(heartbeat);
    await indexerRepo.release(key, cursor.lease);
  }
}
