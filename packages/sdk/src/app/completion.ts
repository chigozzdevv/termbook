import { decodeEventLog, decodeFunctionData, keccak256, stringToHex, type TransactionReceipt } from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
import { executionKey } from "@termbook/schema";
import type { TermbookClient } from "../client/client.js";
import type { ActionOutcome, ExecuteOptions, ExecuteResult, ExecutionCheckpoint } from "../types/credit.types.js";
import { executionCoreAbi, executionManagerAbi } from "./execution.js";

export class ExecutionPendingError extends Error {
  constructor(readonly checkpoint: ExecutionCheckpoint, readonly outcomes: ActionOutcome[] = [], message = "action-pending", cause?: unknown) {
    super(message, { cause });
  }
}
const word = /^0x[a-fA-F0-9]{64}$/;
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const statuses = ["none", "pending", "cancel_requested", "settled", "cancelled", "failed", "expired"] as const;

function storageKey(checkpoint: ExecutionCheckpoint) {
  return `termbook:execution:${checkpoint.chainId}:${checkpoint.core.toLowerCase()}:${checkpoint.creditId.toLowerCase()}`;
}
export function savedExecution(client: TermbookClient, creditId: `0x${string}`): ExecutionCheckpoint | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey({ chainId: client.config.chainId, core: client.config.core,
      creditId } as ExecutionCheckpoint));
    return raw ? JSON.parse(raw) as ExecutionCheckpoint : undefined;
  } catch { return undefined; }
}
function outcome(id: `0x${string}`, value: Record<string, unknown>): ActionOutcome {
  const status = statuses[Number(value["status"])];
  const number = (name: string) => {
    const n = BigInt(String(value[name]));
    if (n < 0n || n >= 2n ** 256n) throw new Error("action-state-invalid");
    return n;
  };
  const positionId = value["positionId"];
  if (!status || status === "none" || typeof positionId !== "string" || !word.test(positionId)) throw new Error("action-state-invalid");
  const state: ActionOutcome = { pendingId: id, positionId: positionId as `0x${string}`, status,
    committed: number("committed"), filled: number("filled"), refunded: number("refunded"),
    remaining: number("remaining"), liability: number("liability") };
  if (state.filled + state.refunded + state.remaining !== state.committed
    || !["pending", "cancel_requested"].includes(status) && (state.remaining !== 0n || state.liability !== 0n)) throw new Error("action-state-invalid");
  return state;
}
function terminal(outcomes: ActionOutcome[]): ExecuteResult["status"] | undefined {
  if (outcomes.some((state) => ["pending", "cancel_requested"].includes(state.status))) return undefined;
  if (outcomes.every((state) => state.status === "settled")) return "settled";
  if (outcomes.some((state) => state.filled > 0n)) return "partial";
  if (outcomes.some((state) => state.status === "failed")) return "failed";
  return outcomes.every((state) => state.status === "expired") ? "expired" : "cancelled";
}
async function pause(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms); signal?.addEventListener("abort", done, { once: true });
  });
}

export async function completeExecution(client: TermbookClient, creditId: `0x${string}`, input: ExecutionCheckpoint,
  options: ExecuteOptions = {}, reconcile: () => Promise<unknown> = async () => undefined): Promise<ExecuteResult> {
  const checkpoint = { ...input };
  const timeout = options.timeoutMs ?? 30 * 60_000, interval = options.pollIntervalMs ?? 3_000;
  const budget = options.maxReconciliations ?? 8;
  if (!word.test(checkpoint.tx) || !word.test(checkpoint.creditId) || !equal(checkpoint.creditId, creditId)
    || checkpoint.chainId !== client.config.chainId || !equal(checkpoint.core, client.config.core)
    || !/^[a-z][a-z0-9_]{0,63}$/.test(checkpoint.capability)
    || checkpoint.executionKey !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(checkpoint.executionKey)
    || !["submitted", "pending", "complete"].includes(checkpoint.stage)) throw new Error("action-checkpoint-invalid");
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(interval) || interval <= 0
    || !Number.isInteger(budget) || budget < 0 || budget > 32) throw new Error("param-invalid");
  let outcomes: ActionOutcome[] = [], attempts = 0;
  const progress = async () => {
    try { globalThis.localStorage?.setItem(storageKey(checkpoint), JSON.stringify(checkpoint)); } catch { /* External persistence is supported. */ }
    await options.onProgress?.({ ...checkpoint }, outcomes.map((state) => ({ ...state })));
  };
  const until = Date.now() + timeout;
  try {
    await client.ready();
    if (checkpoint.executionKey !== undefined && !client.config.actions?.some((route) => route.capability === checkpoint.capability
      && executionKey(route) === checkpoint.executionKey)) throw new Error("action-checkpoint-invalid");
    await progress();
    const rpc = client.rpc.client;
    if (await rpc.getChainId() !== checkpoint.chainId) throw new Error("chain-mismatch");
    let receipt: TransactionReceipt | undefined;
    while (!receipt) {
      if (options.signal?.aborted || Date.now() >= until) throw new ExecutionPendingError(checkpoint, outcomes, options.signal?.aborted ? "action-aborted" : undefined);
      const finalized = await rpc.getBlock({ blockTag: "finalized" });
      try { receipt = await rpc.getTransactionReceipt({ hash: checkpoint.tx }); } catch { /* The signed transaction may still be propagating. */ }
      if (receipt && receipt.blockNumber > finalized.number) receipt = undefined;
      if (!receipt) { await pause(Math.max(1, Math.min(interval, until - Date.now())), options.signal); continue; }
      if (!equal((await rpc.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash)) throw new Error("action-receipt-mismatch");
    }
    const tx = await rpc.getTransaction({ hash: checkpoint.tx });
    if (!tx.to || !equal(tx.to, checkpoint.core)) throw new Error("action-transaction-mismatch");
    const decoded = decodeFunctionData({ abi: executionCoreAbi, data: tx.input });
    if (decoded.functionName !== "executePlan" || !equal(decoded.args[0], creditId)
      || decoded.args[1].capability !== keccak256(stringToHex(checkpoint.executionKey ?? checkpoint.capability))) throw new Error("action-transaction-mismatch");
    if (receipt.status !== "success") {
      checkpoint.stage = "complete"; await progress();
      return { status: "failed", draw: 0n, tx: checkpoint.tx, error: "transaction-reverted", checkpoint };
    }
    const draw = decoded.args[2].drawAmount;
    const blockNumber = (await rpc.getBlock({ blockTag: "finalized" })).number;
    const details = await client.rpc.read<Record<string, unknown>>(checkpoint.core, termbookCoreAbi, "creditDetails", [creditId], blockNumber);
    const field = (key: string, index: number) => Array.isArray(details) ? details[index] : details[key];
    const bundle = field("bundleId", 20) as `0x${string}`;
    const manager = await client.rpc.read<`0x${string}`>(checkpoint.core, executionCoreAbi, "executionManager", [], blockNumber);
    if (!client.config.versionId || !equal(bundle, client.config.versionId)) throw new Error("action-bundle-mismatch");
    const ids: `0x${string}`[] = [];
    for (const log of receipt.logs) {
      if (!equal(log.address, manager)) continue;
      try {
        const event = decodeEventLog({ abi: executionManagerAbi, data: log.data, topics: log.topics });
        if (event.eventName === "ActionPending" && equal(event.args.creditId, creditId)) ids.push(event.args.pendingId);
      } catch { /* Other logs do not identify pending actions. */ }
    }
    if (ids.length > 32 || new Set(ids).size !== ids.length) throw new Error("action-pending-ids-invalid");
    checkpoint.stage = ids.length ? "pending" : "complete";
    await progress();
    while (true) {
      if (options.signal?.aborted || Date.now() >= until) throw new ExecutionPendingError(checkpoint, outcomes, options.signal?.aborted ? "action-aborted" : undefined);
      const at = (await rpc.getBlock({ blockTag: "finalized" })).number;
      outcomes = await Promise.all(ids.map(async (id) => {
        const record = await client.rpc.read<readonly [unknown, unknown, unknown, unknown, Record<string, unknown>]>(manager,
          executionManagerAbi, "records", [creditId, id], at);
        return outcome(id, record[4]);
      }));
      const status = terminal(outcomes);
      checkpoint.stage = status ? "complete" : "pending"; await progress();
      if (status) return { status, draw, tx: checkpoint.tx, pendingIds: ids, outcomes, checkpoint };
      if (attempts < budget) { const tx = await reconcile(); if (tx) ++attempts; }
      await pause(Math.max(1, Math.min(interval, until - Date.now())), options.signal);
    }
  } catch (error) {
    if (error instanceof ExecutionPendingError) throw error;
    throw new ExecutionPendingError(checkpoint, outcomes, error instanceof Error ? error.message : "action-pending", error);
  }
}
