import { quoteHash, verifyQuoteSignature, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../http/http.errors.js";

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const routeSchema = z.object({
  routeId: bytes32,
  routeVersion: bytes32,
  kind: z.enum(["repay", "recovery", "lp_deposit"]),
  sourceChain: z.number().int().positive(),
  sourceAsset: address,
  sourceAssetId: z.string().min(1),
  destinationAssetId: z.string().min(1),
  vault: address,
  token: address,
  maxAmountIn: z.string().regex(/^\d+$/),
  slippageBps: z.number().int().min(0).max(1000),
  recoveryVault: address.optional(),
});
const quoteSchema = z.object({
  quoteRequest: z.object({
    dry: z.boolean(), swapType: z.string(), originAsset: z.string(), destinationAsset: z.string(),
    depositType: z.string(), refundType: z.string(), recipientType: z.string(),
    amount: z.string(), recipient: z.string(), refundTo: z.string(), slippageTolerance: z.number(),
  }).passthrough(),
  quote: z.object({
    depositAddress: address, amountIn: z.string().regex(/^\d+$/),
    amountOut: z.string().regex(/^\d+$/), minAmountOut: z.string().regex(/^\d+$/),
    deadline: z.string(), depositMemo: z.unknown().optional(),
  }).passthrough(),
}).passthrough();

export type AuroraRoute = z.infer<typeof routeSchema>;

export function admittedRoute(input: {
  routeId: string;
  routeVersion: string;
  kind: string;
  sourceChain: number;
  sourceAsset: string;
  vault: string;
  token: string;
  maxAmountIn: string;
  sourceRefundRecipient: string;
}): AuroraRoute {
  if (!env.auroraRoutes || !env.auroraApiKey) throw new HttpError(503, "settlement-route-unavailable");
  let routes: AuroraRoute[];
  try {
    routes = z.array(routeSchema).parse(JSON.parse(env.auroraRoutes));
  } catch {
    throw new HttpError(503, "settlement-route-unavailable");
  }
  const route = routes.find((candidate) =>
    candidate.routeId.toLowerCase() === input.routeId.toLowerCase()
    && candidate.routeVersion.toLowerCase() === input.routeVersion.toLowerCase()
    && candidate.kind === input.kind
    && candidate.sourceChain === input.sourceChain
    && candidate.sourceAsset.toLowerCase() === input.sourceAsset.toLowerCase()
    && candidate.vault.toLowerCase() === input.vault.toLowerCase()
    && candidate.token.toLowerCase() === input.token.toLowerCase()
    && BigInt(input.maxAmountIn) <= BigInt(candidate.maxAmountIn)
    && (candidate.kind !== "recovery" || candidate.recoveryVault?.toLowerCase() === input.sourceRefundRecipient.toLowerCase()),
  );
  if (!route) throw new HttpError(403, "settlement-route-not-admitted");
  return route;
}

export async function requestAuroraQuote(input: {
  route: AuroraRoute;
  inbox: string;
  amountIn: string;
  minAmountOut: string;
  maxReceived: string;
  sourceRefundRecipient: string;
  deadline: number;
}): Promise<OneClickQuoteResponse> {
  const request = {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: input.route.slippageBps,
    originAsset: input.route.sourceAssetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: input.route.destinationAssetId,
    amount: input.amountIn,
    refundTo: input.sourceRefundRecipient,
    refundType: "ORIGIN_CHAIN",
    recipient: input.inbox,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(input.deadline * 1000).toISOString(),
    depositMode: "SIMPLE",
  } as const;
  let response: Response;
  try {
    response = await fetch("https://1click.chaindefuser.com/v0/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": env.auroraApiKey },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, "aurora-quote-unavailable");
  }
  if (!response.ok) throw new HttpError(502, "aurora-quote-unavailable");
  let body: OneClickQuoteResponse;
  try {
    body = quoteSchema.parse(await response.json()) as unknown as OneClickQuoteResponse;
    if (!verifyQuoteSignature(body)) throw new Error("invalid-signature");
  } catch {
    throw new HttpError(502, "aurora-quote-invalid");
  }
  const echoed = body.quoteRequest;
  const quote = body.quote;
  if (
    !echoed || !quote || echoed.dry !== false || echoed.swapType !== "EXACT_INPUT"
      || echoed.originAsset !== request.originAsset || echoed.destinationAsset !== request.destinationAsset
      || echoed.depositType !== "ORIGIN_CHAIN" || echoed.refundType !== "ORIGIN_CHAIN"
      || echoed.recipientType !== "DESTINATION_CHAIN" || echoed.amount !== request.amount
      || echoed.recipient.toLowerCase() !== input.inbox.toLowerCase()
      || echoed.refundTo.toLowerCase() !== input.sourceRefundRecipient.toLowerCase()
      || echoed.slippageTolerance !== request.slippageTolerance
      || !quote.depositAddress || !address.safeParse(quote.depositAddress).success
      || quote.depositMemo || !quote.deadline
      || Date.parse(quote.deadline) <= Date.now() || Date.parse(quote.deadline) > input.deadline * 1000
      || BigInt(quote.amountIn) !== BigInt(input.amountIn)
      || BigInt(quote.minAmountOut) < BigInt(input.minAmountOut)
      || BigInt(quote.amountOut) > BigInt(input.maxReceived)
  ) throw new HttpError(502, "aurora-quote-invalid");
  return body;
}

const statusSchema = z.object({
  status: z.enum(["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"]),
  quoteResponse: quoteSchema,
  swapDetails: z.object({
    refundedAmount: z.string().regex(/^\d+$/).optional(),
    originChainTxHashes: z.array(z.object({ hash: z.string() })).optional(),
    destinationChainTxHashes: z.array(z.object({ hash: z.string() })).optional(),
  }).passthrough(),
});

export async function requestAuroraStatus(quote: OneClickQuoteResponse) {
  const depositAddress = quote.quote.depositAddress;
  if (!depositAddress || !address.safeParse(depositAddress).success) throw new HttpError(502, "aurora-status-invalid");
  const url = new URL("https://1click.chaindefuser.com/v0/status");
  url.searchParams.set("depositAddress", depositAddress);
  let response: Response;
  try {
    response = await fetch(url, { headers: { "X-API-Key": env.auroraApiKey }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, "aurora-status-unavailable");
  }
  if (!response.ok) throw new HttpError(502, "aurora-status-unavailable");
  try {
    const status = statusSchema.parse(await response.json());
    const returnedQuote = status.quoteResponse as unknown as OneClickQuoteResponse;
    if (!verifyQuoteSignature(returnedQuote) || quoteHash(returnedQuote) !== quoteHash(quote)) throw new Error("quote-mismatch");
    return {
      status: status.status,
      refundedAmount: status.swapDetails.refundedAmount ?? "0",
      originTxHashes: status.swapDetails.originChainTxHashes?.map((tx) => tx.hash) ?? [],
      destinationTxHashes: status.swapDetails.destinationChainTxHashes?.map((tx) => tx.hash) ?? [],
    };
  } catch {
    throw new HttpError(502, "aurora-status-invalid");
  }
}
