import type { CollateralSelection } from "@termbook/schema";

export type EvmCollateralSelection = { chainId: number; asset: `0x${string}`; amount: bigint; owner?: `0x${string}`; recipient?: `0x${string}` };

export type IntentRequest = {
  collateral: EvmCollateralSelection | CollateralSelection;
  credit: { limit?: bigint; duration: number };
  action?: { capability: string; params: Record<string, unknown>; target?: `0x${string}`; data?: `0x${string}` };
};
