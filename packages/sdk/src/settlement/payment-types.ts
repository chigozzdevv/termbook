import type { Hex } from "viem";
import type { SettlementRegistration } from "./settlement.js";

export type PaymentRoute = {
  routeId: Hex; routeVersion: Hex; kind: "repay" | "lp_deposit";
  sourceChain: number; sourceAsset: Hex; vault: Hex; token: Hex;
  sourceAssetId: string; destinationAssetId: string; maxAmountIn: string; slippageBps: number;
  sourceAddressFormat: "evm" | "solana"; sourceRpcUrl: string;
  sourceKind?: "erc20" | "native"; sourceGenesis?: Hex;
};
export type PaymentSource = {
  chainId: number; asset: Hex; maxAmountIn: bigint; maxReceived: bigint;
  routeId: Hex; routeVersion: Hex; sourceRefund: Hex; monadRefund: Hex;
  sourceAddressFormat?: "evm" | "solana"; sourceRefundRecipient?: string;
};
export type PaymentInput = {
  kind: "repay" | "lp_deposit"; payer: Hex; vault: Hex; token: Hex; creditId?: Hex;
  amount: string; minShares?: string; source: {
    chainId: number; asset: Hex; maxAmountIn: string; maxReceived: string;
    routeId: Hex; routeVersion: Hex; sourceRefund: Hex; monadRefund: Hex;
    sourceAddressFormat?: "evm" | "solana"; sourceRefundRecipient?: string;
  }; deadline: number;
};
export type SourcePaymentSubmission = { raw: string; blockhash: string; lastValidBlockHeight: number };
export type PaymentCheckpoint = {
  chainId: number; factory: Hex; input: PaymentInput; nonce: string; operationId: Hex;
  registrationTx?: Hex; registration?: string; sourceTx?: string; sourceSender?: string; sourceSubmission?: SourcePaymentSubmission;
  settlementTx?: Hex; stage: "registered" | "quoted" | "funding" | "funded" | "complete";
};
export type PaymentSourceWallet = {
  address: string;
  fund(registration: SettlementRegistration, route: PaymentRoute,
    onSubmitted: (tx: string, submission?: SourcePaymentSubmission) => Promise<void>): Promise<string>;
};
export type PaymentOptions = import("./local-payment.js").LocalPaymentOptions & {
  checkpoint?: PaymentCheckpoint; sourceWallet?: PaymentSourceWallet;
  sourceTx?: string; timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal;
  onProgress?: (checkpoint: PaymentCheckpoint) => void | Promise<void>;
};
export type PaymentOutcome = {
  status: "applied" | "partial" | "refunded";
  applied: bigint; refunded: bigint; sourceRefunded: bigint; remaining: bigint; shares: bigint;
  registration?: SettlementRegistration; checkpoint: PaymentCheckpoint;
};
