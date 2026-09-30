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
};

export type CreditActivity = ActivityEvent;

export type ExecuteResult = {
  status: "settled" | "pending" | "failed" | "cancelled" | "expired";
  draw: bigint;
  tx?: `0x${string}`;
  error?: string;
  pendingIds?: `0x${string}`[];
};
