import type { CollateralSelection } from "@termbook/schema";
import type { AppAction } from "./app.types.js";

export type EvmCollateralSelection = { chainId: number; asset: `0x${string}`; amount: bigint; owner?: `0x${string}`; recipient?: `0x${string}` };

export type IntentRequest = {
  collateral: EvmCollateralSelection | CollateralSelection;
  credit: { limit?: bigint; duration: number };
  action?: AppAction;
};
