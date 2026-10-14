import type { ActivityEvent } from "./client.types.js";

export type CreditSummary = {
  id: `0x${string}`;
  facility: string;
  limit: bigint;
  debt: bigint;
  revision: bigint;
  payment?: string;
  account?: `0x${string}`;
  vault?: `0x${string}`;
  maturity?: number;
};

export type CreditActivity = ActivityEvent;

export type ExecuteResult = {
  status: "settled" | "partial" | "pending" | "failed" | "cancelled" | "expired";
  draw: bigint;
  tx?: `0x${string}`;
  error?: string;
  pendingIds?: `0x${string}`[];
  outcomes?: ActionOutcome[];
  checkpoint?: ExecutionCheckpoint;
};

export type ActionOutcome = {
  pendingId: `0x${string}`; positionId: `0x${string}`;
  status: "pending" | "cancel_requested" | "settled" | "cancelled" | "failed" | "expired";
  committed: bigint; filled: bigint; refunded: bigint; remaining: bigint; liability: bigint;
};
export type ExecutionCheckpoint = {
  chainId: number; core: `0x${string}`; creditId: `0x${string}`; tx: `0x${string}`;
  capability: string; executionKey?: string; stage: "submitted" | "pending" | "complete";
};
export type ExecuteOptions = {
  checkpoint?: ExecutionCheckpoint; timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal;
  maxReconciliations?: number;
  onProgress?: (checkpoint: ExecutionCheckpoint, outcomes: ActionOutcome[]) => void | Promise<void>;
};
