export type RepayArgs = {
  amount: bigint | "max";
  from: "credit_account" | "wallet" | "aurora_intents";
  maxPayment?: bigint;
  deadline?: number;
  source?: {
    sourceAddressFormat?: "evm" | "solana";
    sourceRefundRecipient?: string;
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

export type RepayResult = {
  applied: bigint;
  remaining: bigint;
  status: "applied" | "partial" | "refunded" | "pending";
  tx?: `0x${string}`;
  approvalCleanupTx?: `0x${string}`;
  approvalCleanupRequired?: boolean;
  operationId?: `0x${string}`;
  inbox?: `0x${string}`;
  depositAddress?: string;
  amountIn?: bigint;
  deadline?: string;
  providerQuote?: unknown;
  registration?: SettlementRegistration;
  localCheckpoint?: import("../settlement/local-payment.js").LocalPaymentCheckpoint;
  checkpoint?: import("../settlement/payment-types.js").PaymentCheckpoint;
  refunded?: bigint;
  sourceRefunded?: bigint;
};
import type { SettlementRegistration } from "../settlement/settlement.js";

export type { PaymentCheckpoint, PaymentOptions, PaymentRoute, PaymentSourceWallet } from "../settlement/payment-types.js";
export type { LocalPaymentCheckpoint, LocalPaymentOptions } from "../settlement/local-payment.js";
