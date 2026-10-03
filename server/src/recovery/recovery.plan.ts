import { quoteHash, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { hashTypedData, keccak256, recoverTypedDataAddress, stringToHex } from "viem";
import { z } from "zod";
import { env } from "../config/env.js";
import { admittedRoute, verifyAuroraQuote } from "../settlement/aurora.client.js";
import type { RecoveryFundingRecord } from "./recovery.repo.js";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const amount = z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n);
const operationSchema = z.object({
  operationId: bytes32,
  registrationTxHash: bytes32,
  kind: z.literal("recovery"),
  payer: address,
  nonce: z.string().regex(/^\d+$/),
  sourceChain: z.number().int().positive(),
  sourceAsset: address,
  vault: address,
  token: address,
  creditId: bytes32,
  maxAmountIn: amount,
  minAmountOut: amount,
  maxReceived: amount,
  deadline: z.number().int().positive(),
  sourceRefundRecipient: address,
  monadRefundRecipient: address,
  refundRecipient: address,
  routeId: bytes32,
  routeVersion: bytes32,
  inbox: address,
  quote: z.unknown(),
  providerStatus: z.string().optional(),
});
export type Operation = z.infer<typeof operationSchema>;

export function recoveryFactoryOperation(operation: Operation) {
  return {
    operationId: operation.operationId as `0x${string}`,
    kind: 1,
    payer: operation.payer as `0x${string}`,
    sourceChain: BigInt(operation.sourceChain),
    sourceAsset: operation.sourceAsset as `0x${string}`,
    vault: operation.vault as `0x${string}`,
    token: operation.token as `0x${string}`,
    creditId: operation.creditId as `0x${string}`,
    maxAmountIn: BigInt(operation.maxAmountIn),
    minOut: BigInt(operation.minAmountOut),
    maxReceived: BigInt(operation.maxReceived),
    sourceRefund: operation.sourceRefundRecipient as `0x${string}`,
    refundRecipient: operation.refundRecipient as `0x${string}`,
    deadline: BigInt(operation.deadline),
    routeId: operation.routeId as `0x${string}`,
    routeVersion: operation.routeVersion as `0x${string}`,
    lpRecipient: "0x0000000000000000000000000000000000000000" as const,
    minShares: 0n,
  };
}

export type Funding = {
  creditId: `0x${string}`;
  operationId: `0x${string}`;
  inbox: `0x${string}`;
  depositAddress: `0x${string}`;
  amount: bigint;
  quoteHash: `0x${string}`;
  nonce: bigint;
  deadline: bigint;
};

export function recoveryFundingTypedData(operation: Operation, funding: Funding) {
  return {
    domain: {
      name: "Termbook", version: "1", chainId: operation.sourceChain,
      verifyingContract: operation.sourceRefundRecipient as `0x${string}`,
    },
    primaryType: "RecoveryFunding",
    types: { RecoveryFunding: [
      { name: "creditId", type: "bytes32" }, { name: "operationId", type: "bytes32" },
      { name: "inbox", type: "address" }, { name: "depositAddress", type: "address" },
      { name: "amount", type: "uint256" }, { name: "quoteHash", type: "bytes32" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      { name: "monadChain", type: "uint256" }, { name: "asset", type: "address" },
    ] },
    message: { ...funding, monadChain: BigInt(env.monadChainId), asset: operation.sourceAsset as `0x${string}` },
  } as const;
}

export async function verifiedRiskSignature(
  operation: Operation,
  funding: Funding,
  approval: { creditId: string; fundingDigest: string; riskSigner: string; signature: string; deadline: number },
  expectedSigner: `0x${string}`,
): Promise<`0x${string}`> {
  const typedData = recoveryFundingTypedData(operation, funding);
  if (
    approval.creditId.toLowerCase() !== funding.creditId.toLowerCase()
      || approval.fundingDigest.toLowerCase() !== hashTypedData(typedData).toLowerCase()
      || approval.riskSigner.toLowerCase() !== expectedSigner.toLowerCase()
      || approval.deadline !== Number(funding.deadline)
  ) throw new Error("recovery-risk-approval-invalid");
  let recovered: `0x${string}`;
  try {
    recovered = await recoverTypedDataAddress({ ...typedData, signature: approval.signature as `0x${string}` });
  } catch {
    throw new Error("recovery-risk-approval-invalid");
  }
  if (recovered.toLowerCase() !== expectedSigner.toLowerCase()) throw new Error("recovery-risk-approval-invalid");
  return approval.signature as `0x${string}`;
}

const equal = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

function operationDigest(operation: Operation): `0x${string}` {
  const message = recoveryFactoryOperation(operation);
  return hashTypedData({
    domain: { name: "Termbook", version: "1", chainId: env.monadChainId, verifyingContract: env.settlementFactory as `0x${string}` },
    primaryType: "SettlementOperation",
    types: { SettlementOperation: [
      { name: "operationId", type: "bytes32" }, { name: "kind", type: "uint8" },
      { name: "payer", type: "address" }, { name: "sourceChain", type: "uint256" },
      { name: "sourceAsset", type: "address" }, { name: "vault", type: "address" },
      { name: "token", type: "address" }, { name: "creditId", type: "bytes32" },
      { name: "maxAmountIn", type: "uint256" }, { name: "minOut", type: "uint256" },
      { name: "maxReceived", type: "uint256" }, { name: "sourceRefund", type: "address" },
      { name: "refundRecipient", type: "address" }, { name: "deadline", type: "uint256" },
      { name: "routeId", type: "bytes32" }, { name: "routeVersion", type: "bytes32" },
      { name: "lpRecipient", type: "address" }, { name: "minShares", type: "uint256" },
    ] },
    message,
  });
}

export function recoveryFundingPlan(input: unknown): { operation: Operation; record: RecoveryFundingRecord; funding: Funding; digest: `0x${string}` } {
  const operation = operationSchema.parse(input);
  const quote = operation.quote as OneClickQuoteResponse;
  if (!quote || !verifyAuroraQuote(quote)) throw new Error("recovery-quote-invalid");
  const echoed = quote.quoteRequest;
  const terms = quote.quote;
  const quoteDeadline = Date.parse(terms?.deadline ?? "");
  if (
    !echoed || !terms || echoed.dry !== false || echoed.swapType !== "EXACT_INPUT"
      || echoed.depositType !== "ORIGIN_CHAIN" || echoed.refundType !== "ORIGIN_CHAIN"
      || echoed.recipientType !== "DESTINATION_CHAIN" || echoed.amount !== operation.maxAmountIn
      || !equal(echoed.recipient, operation.inbox) || !equal(echoed.refundTo, operation.sourceRefundRecipient)
      || !address.safeParse(terms.depositAddress).success || terms.depositMemo
      || BigInt(terms.amountIn) !== BigInt(operation.maxAmountIn)
      || BigInt(terms.minAmountOut) < BigInt(operation.minAmountOut)
      || BigInt(terms.amountOut) > BigInt(operation.maxReceived)
      || !Number.isFinite(quoteDeadline)
      || quoteDeadline > operation.deadline * 1000
      || !equal(operation.monadRefundRecipient, operation.refundRecipient)
  ) throw new Error("recovery-quote-invalid");
  const hash = keccak256(stringToHex(quoteHash(quote)));
  const record: RecoveryFundingRecord = {
    operationId: operation.operationId,
    creditId: operation.creditId,
    nonce: operation.nonce,
    sourceChain: operation.sourceChain,
    recoveryVault: operation.sourceRefundRecipient,
    inbox: operation.inbox,
    depositAddress: terms.depositAddress as string,
    amount: operation.maxAmountIn,
    quoteHash: hash,
    deadline: Math.floor(quoteDeadline / 1000),
  };
  const funding: Funding = {
    creditId: operation.creditId as `0x${string}`,
    operationId: operation.operationId as `0x${string}`,
    inbox: operation.inbox as `0x${string}`,
    depositAddress: terms.depositAddress as `0x${string}`,
    amount: BigInt(record.amount),
    quoteHash: hash,
    nonce: BigInt(operation.nonce),
    deadline: BigInt(record.deadline),
  };
  return { operation, record, funding, digest: operationDigest(operation) };
}

export function verifyRoute(operation: Operation): void {
  const route = admittedRoute({
    routeId: operation.routeId,
    routeVersion: operation.routeVersion,
    kind: operation.kind,
    sourceChain: operation.sourceChain,
    sourceAsset: operation.sourceAsset,
    vault: operation.vault,
    token: operation.token,
    maxAmountIn: operation.maxAmountIn,
    sourceRefundRecipient: operation.sourceRefundRecipient,
  });
  const quote = operation.quote as OneClickQuoteResponse;
  if (
    quote.quoteRequest.originAsset !== route.sourceAssetId
      || quote.quoteRequest.destinationAsset !== route.destinationAssetId
      || quote.quoteRequest.slippageTolerance !== route.slippageBps
  ) throw new Error("recovery-route-quote-mismatch");
}
