export type WithdrawArgs = { asset: `0x${string}`; amount: bigint };
export type HealthView = { value: bigint | null; debt: bigint; state: string };
