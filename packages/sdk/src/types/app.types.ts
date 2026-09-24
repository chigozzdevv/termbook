export type AppAction = {
  capability: string;
  params: Record<string, unknown>;
};

export type ActionReview = {
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
