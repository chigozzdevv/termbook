import type { ActivityEvent, TxHash } from "./client.types.js";
import type { SettlementRegistration } from "../settlement/settlement.js";

export type HouseSummary = { id: `0x${string}`; vault: `0x${string}`; asset: `0x${string}`; sharePrice?: bigint };
export type DepositArgs = {
  amount: bigint;
  minShares: bigint;
  deadline: number;
  source?: {
    provider: "aurora_intents";
    chainId: number;
    asset: `0x${string}`;
    maxAmountIn: bigint;
    maxReceived: bigint;
    routeId: `0x${string}`;
    routeVersion: `0x${string}`;
    sourceRefund: `0x${string}`;
    monadRefund: `0x${string}`;
  };
};
export type HouseAccountSummary = { owner: `0x${string}`; shares: bigint; sharePrice: bigint; assets: bigint };
export type HouseDepositResult = { shares: bigint; status: "submitted" | "pending"; tx?: TxHash; operationId?: `0x${string}`; inbox?: `0x${string}`; depositAddress?: string; amountIn?: bigint; deadline?: string; providerQuote?: unknown; registration?: SettlementRegistration };
export type WithdrawalView = { id: bigint; owner: `0x${string}`; recipient: `0x${string}`; shares: bigint; amount: bigint; claimed: boolean; cancelled: boolean };
export type HouseActivity = ActivityEvent;
