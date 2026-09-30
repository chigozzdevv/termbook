import { inboxFactoryAbi, settlementInboxAbi, termbookCoreAbi } from "@termbook/bindings";
import { parseAbi, type Hex } from "viem";
import { HttpClient } from "../transport/http.js";
import type { TermbookClient } from "../client/client.js";
import { solanaAlias, solanaPubkeyBytes } from "../collateral/solana.js";
import { operationId } from "./operation.js";
import { settlementNonce, type SettlementRegistration } from "./settlement.js";
import { connectPaymentWallet, verifyPaymentTransfer, verifySourceRefund } from "./payment-wallet.js";
import type { PaymentCheckpoint, PaymentInput, PaymentOptions, PaymentOutcome, PaymentRoute } from "./payment-types.js";
import { quoteHash, verifyQuoteSignature } from "@defuse-protocol/one-click-sdk-typescript";

const zero = `0x${"0".repeat(64)}` as Hex;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const accountingAbi = parseAbi(["function untrackedApplied() view returns (uint256)", "function untrackedRefunded() view returns (uint256)"]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const mintedAbi = parseAbi(["function lpInboxShares(address inbox) view returns (uint256)"]);
export class PaymentPendingError extends Error {
  constructor(readonly checkpoint: PaymentCheckpoint, cause?: unknown) { super("payment-pending", { cause }); }
}
export class PaymentExpiredError extends Error {
  constructor(readonly checkpoint: PaymentCheckpoint) { super("payment-unfunded-expired"); }
}
function storageKey(client: TermbookClient, input: Pick<PaymentInput, "kind" | "vault" | "creditId">) {
  return `termbook:payment:${client.config.chainId}:${client.config.settlementFactory}:${client.signer.address().toLowerCase()}:${input.kind}:${input.creditId ?? input.vault.toLowerCase()}`;
}
export function savedPayment(client: TermbookClient, input: Pick<PaymentInput, "kind" | "vault" | "creditId">): PaymentCheckpoint | undefined {
  try { const raw = globalThis.localStorage?.getItem(storageKey(client, input)); return raw ? JSON.parse(raw) : undefined; }
  catch { return undefined; }
}
function serialize(value: unknown) { return JSON.stringify(value, (_, v) => typeof v === "bigint" ? String(v) : v); }
function restoreRegistration(value: string): SettlementRegistration {
  const saved = JSON.parse(value) as SettlementRegistration;
  saved.amountIn = BigInt(saved.amountIn);
  if (saved.operation) for (const key of ["sourceChain", "maxAmountIn", "minOut", "maxReceived", "deadline", "minShares"] as const) saved.operation[key] = BigInt(saved.operation[key]);
  return saved;
}
export async function remotePayment(client: TermbookClient, requested: PaymentInput, options: PaymentOptions = {}): Promise<PaymentOutcome> {
  await client.ready();
  const factory = client.config.settlementFactory;
  if (!factory || !client.config.apiBase) throw new Error("settlement-route-required");
  const saved = options.checkpoint ?? savedPayment(client, requested);
  const resuming = saved && (options.checkpoint || saved.stage !== "complete");
  const input = resuming ? saved.input : requested;
  if (input.kind !== requested.kind || !same(input.vault, requested.vault) || input.creditId !== requested.creditId
    || !same(input.payer, client.signer.address())) throw new Error("payment-checkpoint-invalid");
  if (resuming && !options.checkpoint && serialize(input) !== serialize(requested)) throw new Error("payment-already-pending");
  const nonce = resuming ? BigInt(saved.nonce) : settlementNonce();
  const id = operationId({ kind: input.kind, payer: input.payer, nonce, chainId: input.source.chainId,
    creditId: input.creditId, routeVersion: input.source.routeVersion, asset: input.source.asset, vault: input.vault });
  const checkpoint: PaymentCheckpoint = resuming ? { ...saved } : {
    chainId: client.config.chainId, factory, input, nonce: String(nonce), operationId: id, stage: "registered",
  };
  if (checkpoint.chainId !== client.config.chainId || !same(checkpoint.factory, factory) || !same(id, checkpoint.operationId)
    || !["registered", "quoted", "funding", "funded", "complete"].includes(checkpoint.stage)
    || !/^\d+$/.test(input.amount) || BigInt(input.amount) <= 0n || !Number.isSafeInteger(input.deadline)) throw new Error("payment-checkpoint-invalid");
  const timeout = options.timeoutMs ?? 30 * 60_000, interval = options.pollIntervalMs ?? 3_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(interval) || interval <= 0) throw new Error("param-invalid");
  const until = Date.now() + timeout;
  const progress = async () => {
    try { globalThis.localStorage?.setItem(storageKey(client, input), serialize(checkpoint)); } catch { /* Callbacks support external persistence. */ }
    await options.onProgress?.(JSON.parse(serialize(checkpoint)) as PaymentCheckpoint);
  };
  const interrupted = () => { if (options.signal?.aborted || Date.now() >= until) throw new PaymentPendingError(checkpoint); };
  const pause = async () => {
    interrupted();
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, Math.min(interval, Math.max(1, until - Date.now())));
      options.signal?.addEventListener("abort", finish, { once: true });
    });
  };
  await progress();
  try {
    const chain = client.rpc.client;
    if (await chain.getChainId() !== client.config.chainId) throw new Error("chain-mismatch");
    const routes = await new HttpClient(client.config.apiBase).get<PaymentRoute[]>("/settlement/routes");
    const route = routes.find((row) => row.kind === input.kind && same(row.routeId, input.source.routeId)
      && same(row.routeVersion, input.source.routeVersion) && row.sourceChain === input.source.chainId
      && same(row.sourceAsset, input.source.asset) && same(row.vault, input.vault) && same(row.token, input.token));
    if (!route || !route.sourceRpcUrl || !["evm", "solana"].includes(route.sourceAddressFormat)
      || BigInt(input.source.maxAmountIn) > BigInt(route.maxAmountIn)) throw new Error("settlement-route-not-admitted");
    const sourceRefundRecipient = input.source.sourceRefundRecipient ?? input.source.sourceRefund;
    if (route.sourceAddressFormat !== (input.source.sourceAddressFormat ?? "evm")
      || route.sourceAddressFormat === "solana" && (!route.sourceGenesis || route.sourceKind !== "native"
        || !same(solanaAlias(route.sourceGenesis, solanaPubkeyBytes(sourceRefundRecipient)), input.source.sourceRefund))
      || route.sourceAddressFormat === "evm" && !same(sourceRefundRecipient, input.source.sourceRefund)) throw new Error("source-refund-invalid");
    let registration = checkpoint.registration ? restoreRegistration(checkpoint.registration) : undefined;
    if (!registration) {
      if (input.deadline * 1000 <= Date.now() && !checkpoint.registrationTx) { checkpoint.stage = "complete"; await progress(); throw new PaymentExpiredError(checkpoint); }
      interrupted();
      registration = await client.settlement.register({ kind: input.kind, payer: input.payer, nonce,
        chainId: input.source.chainId, routeId: input.source.routeId, routeVersion: input.source.routeVersion,
        creditId: input.creditId, vault: input.vault, asset: input.source.asset, settlementAsset: input.token,
        maxAmountIn: BigInt(input.source.maxAmountIn), maxReceived: BigInt(input.source.maxReceived),
        minAmountOut: BigInt(input.amount), deadline: input.deadline, sourceRefund: input.source.sourceRefund,
        sourceAddressFormat: route.sourceAddressFormat, sourceRefundRecipient, monadRefund: input.source.monadRefund,
        lpRecipient: input.kind === "lp_deposit" ? input.payer : undefined,
        minShares: input.minShares ? BigInt(input.minShares) : undefined,
        registrationTxHash: checkpoint.registrationTx,
      }, { allowExpiredQuote: !!checkpoint.registrationTx, onSubmitted: async (tx) => { checkpoint.registrationTx = tx; await progress(); } });
      checkpoint.registration = serialize(registration); checkpoint.stage = "quoted"; await progress();
    }
    const expectedOperation = {
      operationId: id, kind: input.kind === "repay" ? 0 : 2, payer: input.payer, sourceChain: BigInt(input.source.chainId),
      sourceAsset: input.source.asset, vault: input.vault, token: input.token, creditId: input.creditId ?? zero,
      maxAmountIn: BigInt(input.source.maxAmountIn), minOut: BigInt(input.amount), maxReceived: BigInt(input.source.maxReceived),
      sourceRefund: input.source.sourceRefund, refundRecipient: input.source.monadRefund, deadline: BigInt(input.deadline),
      routeId: input.source.routeId, routeVersion: input.source.routeVersion,
      lpRecipient: input.kind === "lp_deposit" ? input.payer : "0x0000000000000000000000000000000000000000",
      minShares: BigInt(input.minShares ?? "0"),
    };
    if (!registration.operation || Object.entries(expectedOperation).some(([key, value]) =>
      String(value).toLowerCase() !== String(registration!.operation![key as keyof typeof registration.operation]).toLowerCase())) throw new Error("settlement-operation-mismatch");
    const provider = registration.providerQuote;
    if (!verifyQuoteSignature(provider) || provider.quoteRequest.originAsset !== route.sourceAssetId
      || provider.quoteRequest.destinationAsset !== route.destinationAssetId || provider.quoteRequest.dry !== false
      || provider.quoteRequest.swapType !== "EXACT_INPUT" || provider.quoteRequest.depositType !== "ORIGIN_CHAIN"
      || provider.quoteRequest.refundType !== "ORIGIN_CHAIN" || provider.quoteRequest.recipientType !== "DESTINATION_CHAIN"
      || provider.quoteRequest.amount !== input.source.maxAmountIn || provider.quoteRequest.slippageTolerance !== route.slippageBps
      || !same(provider.quoteRequest.recipient, registration.inbox)
      || (route.sourceAddressFormat === "evm" ? !same(provider.quoteRequest.refundTo, sourceRefundRecipient)
        : provider.quoteRequest.refundTo !== sourceRefundRecipient)
      || provider.quote.depositAddress !== registration.depositAddress || provider.quote.deadline !== registration.deadline || provider.quote.depositMemo
      || registration.operationId !== id || registration.kind !== input.kind || registration.amountIn !== BigInt(input.source.maxAmountIn)
      || BigInt(provider.quote.amountIn) !== registration.amountIn || BigInt(provider.quote.minAmountOut) < BigInt(input.amount)
      || BigInt(provider.quote.amountOut) > BigInt(input.source.maxReceived)
      || !Number.isFinite(Date.parse(registration.deadline)) || Date.parse(registration.deadline) > input.deadline * 1000) throw new Error("settlement-quote-invalid");
    if (options.sourceTx) {
      if (checkpoint.sourceTx && checkpoint.sourceTx !== options.sourceTx) throw new Error("payment-source-transaction-conflict");
      checkpoint.sourceTx = options.sourceTx; checkpoint.sourceSender ??= sourceRefundRecipient; await progress();
    }
    const state = async () => {
      const block = await chain.getBlock({ blockTag: "finalized" }), blockNumber = block.number;
      const read = <T>(address: Hex, abi: readonly unknown[], functionName: string, args: readonly unknown[] = []) =>
        chain.readContract({ address, abi, functionName, args, blockNumber } as never) as Promise<T>;
      const [inbox, digest, expected, vault, token, creditId, received, applied, refunded, untrackedApplied, untrackedRefunded, shares, remaining, balance, cap, effectiveDeadline, cancelled] = await Promise.all([
        read<Hex>(factory, inboxFactoryAbi, "inboxOf", [id]),
        read<Hex>(factory, inboxFactoryAbi, "operationDigestOf", [id]),
        read<Hex>(factory, inboxFactoryAbi, "operationDigest", [registration!.operation]),
        read<Hex>(registration!.inbox, settlementInboxAbi, "vault"), read<Hex>(registration!.inbox, settlementInboxAbi, "token"),
        read<Hex>(registration!.inbox, settlementInboxAbi, "creditId"), read<bigint>(registration!.inbox, settlementInboxAbi, "received"),
        read<bigint>(registration!.inbox, settlementInboxAbi, "applied"), read<bigint>(registration!.inbox, settlementInboxAbi, "refunded"),
        read<bigint>(registration!.inbox, accountingAbi, "untrackedApplied"), read<bigint>(registration!.inbox, accountingAbi, "untrackedRefunded"),
        input.kind === "lp_deposit" ? read<bigint>(input.vault, mintedAbi, "lpInboxShares", [registration!.inbox]) : Promise.resolve(0n),
        input.creditId ? read<bigint>(client.config.core, termbookCoreAbi, "creditDebt", [input.creditId]) : Promise.resolve(0n),
        read<bigint>(input.token, tokenAbi, "balanceOf", [registration!.inbox]),
        read<bigint>(registration!.inbox, settlementInboxAbi, "maxReceived"),
        read<bigint>(registration!.inbox, settlementInboxAbi, "deadline"),
        read<boolean>(registration!.inbox, settlementInboxAbi, "cancelled"),
      ]);
      if (!same(inbox, registration!.inbox) || digest !== expected || !same(vault, input.vault) || !same(token, input.token)
        || creditId !== (input.creditId ?? zero) || received < applied + refunded || balance < received - applied - refunded || cap !== BigInt(input.source.maxReceived) || input.kind === "lp_deposit" && (applied > 0n) !== (shares > 0n)) throw new Error("settlement-accounting-invalid");
      return { received, applied: applied + untrackedApplied, refunded: refunded + untrackedRefunded,
        available: received - applied - refunded, remaining, shares, balance, cap, effectiveDeadline, cancelled, timestamp: block.timestamp };
    };
    let current = await state();
    if (!checkpoint.sourceTx && checkpoint.stage === "quoted" && current.received === 0n && current.applied === 0n) {
      if (Date.parse(registration.deadline) <= Date.now()) { checkpoint.stage = "complete"; await progress(); throw new PaymentExpiredError(checkpoint); }
      const wallet = options.sourceWallet ?? (client.config.paymentWalletResolver ? await client.config.paymentWalletResolver(route) : await connectPaymentWallet(route, client.config.chainId));
      if (route.sourceAddressFormat === "evm" ? !same(wallet.address, sourceRefundRecipient) : wallet.address !== sourceRefundRecipient) throw new Error("source-wallet-mismatch");
      checkpoint.stage = "funding"; checkpoint.sourceSender = wallet.address; await progress(); interrupted();
      checkpoint.sourceTx = await wallet.fund(registration, route, async (tx, submission) => { checkpoint.sourceTx = tx; checkpoint.sourceSubmission = submission; await progress(); });
      await progress();
    }
    if (checkpoint.sourceTx) {
      try {
        while (!(checkpoint.sourceSubmission
          ? await verifyPaymentTransfer(route, registration, checkpoint.sourceTx, checkpoint.sourceSender ?? sourceRefundRecipient, checkpoint.sourceSubmission)
          : await verifyPaymentTransfer(route, registration, checkpoint.sourceTx, checkpoint.sourceSender ?? sourceRefundRecipient))) await pause();
      } catch (error) {
        if (error instanceof Error && error.message === "source-transfer-expired") {
          checkpoint.sourceTx = undefined; checkpoint.sourceSubmission = undefined; checkpoint.stage = "quoted"; await progress();
        }
        throw error;
      }
      checkpoint.stage = "funded"; await progress();
    }
    let sourceRefunded = 0n, providerChecked = 0;
    for (;;) {
      interrupted(); current = await state();
      if (Date.now() - providerChecked > 15_000 && sourceRefunded < registration.amountIn) {
        providerChecked = Date.now();
        const reported = await new HttpClient(client.config.apiBase).get<Record<string, unknown>>(`/settlement/${id}`).catch(() => undefined);
        if (reported && same(String(reported["operationId"]), id) && same(String(reported["inbox"]), registration.inbox)
          && reported["quote"] && quoteHash(reported["quote"] as typeof provider) === quoteHash(provider)
          && ["REFUNDED", "FAILED"].includes(String(reported["providerStatus"]))
          && Number(reported["providerStatusCheckedAt"]) > Date.now() - 300_000
          && typeof reported["providerRefundedAmount"] === "string" && /^\d+$/.test(reported["providerRefundedAmount"])) {
          const amount = BigInt(reported["providerRefundedAmount"]);
          if (Array.isArray(reported["providerOriginTxHashes"]) && await verifySourceRefund(route, registration,
            reported["providerOriginTxHashes"] as string[], amount)) sourceRefunded = amount;
        }
      }
      const accounted = current.available === 0n && current.balance === 0n;
      const fulfilled = current.applied >= BigInt(input.amount);
      const partial = current.applied > 0n && current.timestamp > current.effectiveDeadline + 600n;
      const refunded = current.refunded > 0n || sourceRefunded > 0n;
      if (accounted && (fulfilled || partial || refunded)) {
        checkpoint.stage = "complete"; await progress();
        return { status: current.applied === 0n ? "refunded" : fulfilled ? "applied" : "partial", ...current,
          sourceRefunded, registration, checkpoint };
      }
      if (current.balance > current.available && !checkpoint.settlementTx && current.received >= current.cap
        && (current.timestamp > current.effectiveDeadline || input.kind === "lp_deposit" && (current.cancelled || current.applied > 0n))) {
        const refund = current.balance - current.available;
        try {
          await chain.simulateContract({ address: registration.inbox, abi: settlementInboxAbi, functionName: "refundUntracked",
            args: [refund], account: client.signer.address() });
          checkpoint.settlementTx = await client.rpc.write(registration.inbox, settlementInboxAbi, "refundUntracked", [refund]);
          await progress();
        } catch { /* Keepers can refund the excess. */ }
      }
      if (current.balance > current.available && !checkpoint.settlementTx && current.received < current.cap) {
        const untracked = current.balance - current.available;
        const room = current.cap - current.received;
        const notify = untracked < room ? untracked : room;
        try {
          await chain.simulateContract({ address: registration.inbox, abi: settlementInboxAbi, functionName: "notifyReceipt",
            args: [notify], account: client.signer.address() });
          checkpoint.settlementTx = await client.rpc.write(registration.inbox, settlementInboxAbi, "notifyReceipt", [notify]);
          await progress();
        } catch { /* Keepers can notify the receipt. */ }
      }
      if (current.available > 0n && !checkpoint.settlementTx) {
        const amount = input.kind === "repay" && current.available > current.remaining ? current.remaining : current.available;
        const method = amount > 0n && (input.kind === "repay" || !current.cancelled && current.timestamp <= current.effectiveDeadline) ? "settle" : "refund";
        const quantity = method === "settle" ? amount : current.available;
        try {
          await chain.simulateContract({ address: registration.inbox, abi: settlementInboxAbi, functionName: method,
            args: [quantity], account: client.signer.address() });
          checkpoint.settlementTx = await client.rpc.write(registration.inbox, settlementInboxAbi, method, [quantity]);
          await progress();
        } catch { /* Keepers can continue settlement when a wallet cannot submit. */ }
      }
      if (checkpoint.settlementTx) {
        const receipt = await chain.getTransactionReceipt({ hash: checkpoint.settlementTx }).catch(() => undefined);
        if (receipt && receipt.blockNumber <= (await chain.getBlock({ blockTag: "finalized" })).number) {
          checkpoint.settlementTx = undefined; await progress();
        }
      }
      await pause();
    }
  } catch (error) {
    if (error instanceof PaymentPendingError || error instanceof PaymentExpiredError) throw error;
    throw new PaymentPendingError(checkpoint, error);
  }
}
