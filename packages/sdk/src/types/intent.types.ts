export type IntentRequest = {
  collateral: { chainId: number; asset: `0x${string}`; amount: bigint; owner?: `0x${string}`; recipient?: `0x${string}` };
  credit: { limit?: bigint; duration: number };
  action?: { capability: string; params: Record<string, unknown>; target?: `0x${string}`; data?: `0x${string}` };
};
