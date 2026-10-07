import type { TermAction, StandardAction } from "@termbook/schema";
export type { UseCase } from "@termbook/schema";
export type { StandardAction, SpotAction, PerpsAction, VaultAction, StakingAction, LiquidityAction } from "@termbook/schema";

export type AppAction = StandardAction | (Omit<TermAction, "use_case"> & { use_case?: undefined });

export type AppPosition = { positionId: `0x${string}`; marketId: `0x${string}` };
export type AppPendingAction = { actionId: `0x${string}`; positionId: `0x${string}`;
  remainingLiability: bigint; deadline: bigint };

export type ActionReview = {
  price?: import("../app/execution.js").ExecutionPrice;
  boundKind?: "price" | "min_output" | "max_input";
  nativeValue?: bigint;
  spending?: { token: `0x${string}`; amount: bigint }[];
  capability: string;
  requiredInput: bigint;
  freeAssets: bigint;
  draw: bigint;
  currentDebt: bigint;
  projectedDebt: bigint;
  originationFee: bigint;
  healthBps: bigint | null;
  healthState: string;
  projectedHealthBps: bigint;
  initialHealthBps: bigint;
  projectedRecoveryValue: bigint;
  canExecute: boolean;
  settlementAsset: `0x${string}`;
  revision: bigint;
  fingerprint: `0x${string}`;
};
