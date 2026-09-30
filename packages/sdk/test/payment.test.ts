import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TermbookClient } from "../src/client/client.js";
import { remotePayment, PaymentPendingError } from "../src/settlement/payment.js";
import type { PaymentCheckpoint, PaymentInput, PaymentRoute } from "../src/settlement/payment-types.js";
import { operationId } from "../src/settlement/operation.js";
import { verifyPaymentTransfer, verifySourceRefund } from "../src/settlement/payment-wallet.js";

vi.mock("@defuse-protocol/one-click-sdk-typescript", () => ({ verifyQuoteSignature: () => true, quoteHash: () => "bound-quote" }));
vi.mock("../src/settlement/payment-wallet.js", () => ({
  verifyPaymentTransfer: vi.fn(async () => true), verifySourceRefund: vi.fn(async () => true), connectPaymentWallet: vi.fn(),
}));
const a = (n: string) => `0x${n.repeat(40)}` as `0x${string}`;
const w = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;
function fixture(kind: "repay" | "lp_deposit" = "repay") {
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const input: PaymentInput = { kind, payer: a("1"), vault: a("2"), token: a("3"),
    creditId: kind === "repay" ? w("4") : undefined, amount: "100", minShares: kind === "lp_deposit" ? "100" : undefined,
    deadline, source: { chainId: 1, asset: a("5"), maxAmountIn: "100", maxReceived: "120",
      routeId: w("6"), routeVersion: w("7"), sourceRefund: a("8"), monadRefund: a("1") } };
  const route: PaymentRoute = { routeId: w("6"), routeVersion: w("7"), kind, sourceChain: 1, sourceAsset: a("5"),
    vault: a("2"), token: a("3"), sourceAssetId: "eth:test", destinationAssetId: "monad:test", maxAmountIn: "200",
    slippageBps: 50, sourceAddressFormat: "evm", sourceRpcUrl: "https://source.example" };
  const values = { received: 0n, applied: 0n, refunded: 0n, remaining: 150n, shares: 0n,
    untrackedApplied: 0n, untrackedRefunded: 0n, timestamp: BigInt(deadline - 300) };
  let registration: Record<string, unknown>;
  const register = vi.fn(async (args, options) => {
    await options.onSubmitted(w("a"));
    const id = operationId({ kind: args.kind, payer: args.payer, nonce: args.nonce, chainId: args.chainId,
      creditId: args.creditId, routeVersion: args.routeVersion, asset: args.asset, vault: args.vault });
    registration = { operationId: id, inbox: a("9"), kind, payer: input.payer, sourceChain: 1, sourceAsset: input.source.asset,
      sourceRefund: input.source.sourceRefund, sourceAddressFormat: "evm", sourceRefundRecipient: a("8"),
      depositAddress: a("b"), amountIn: 100n, deadline: new Date((deadline - 60) * 1000).toISOString(),
      operation: { operationId: id, kind: kind === "repay" ? 0 : 2, payer: input.payer, sourceChain: 1n,
        sourceAsset: input.source.asset, vault: input.vault, token: input.token, creditId: input.creditId ?? w("0"),
        maxAmountIn: 100n, minOut: 100n, maxReceived: 120n, sourceRefund: a("8"), refundRecipient: a("1"),
        deadline: BigInt(deadline), routeId: w("6"), routeVersion: w("7"), lpRecipient: kind === "lp_deposit" ? a("1") : a("0"),
        minShares: kind === "lp_deposit" ? 100n : 0n },
      providerQuote: { quoteRequest: { dry: false, swapType: "EXACT_INPUT", depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN",
        recipientType: "DESTINATION_CHAIN", amount: "100", recipient: a("9"), refundTo: a("8"),
        originAsset: route.sourceAssetId, destinationAsset: route.destinationAssetId, slippageTolerance: 50 },
        quote: { depositAddress: a("b"), amountIn: "100", minAmountOut: "100", amountOut: "110",
          deadline: new Date((deadline - 60) * 1000).toISOString() } },
    };
    return registration;
  });
  const wallet = { address: a("8"), fund: vi.fn(async (_r, _route, onSubmitted) => {
    await onSubmitted(w("c")); values.received = 100n; return w("c");
  }) };
  const rpc = { client: {
    getChainId: async () => 143, getBlock: async () => ({ number: 1n, timestamp: values.timestamp }),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (["operationDigestOf", "operationDigest"].includes(functionName)) return w("d");
      if (functionName === "inboxOf") return a("9");
      if (functionName === "vault") return input.vault;
      if (functionName === "token") return input.token;
      if (functionName === "creditId") return input.creditId ?? w("0");
      if (functionName === "creditDebt") return values.remaining;
      if (functionName === "balanceOf") return values.received - values.applied - values.refunded;
      if (functionName === "maxReceived") return 120n;
      if (functionName === "deadline") return BigInt(deadline);
      if (functionName === "cancelled") return false;
      if (functionName === "lpInboxShares") return values.shares;
      return values[functionName as keyof typeof values];
    }),
    simulateContract: vi.fn(async () => {}), getTransactionReceipt: async () => ({ blockNumber: 1n, status: "success" }),
  }, write: vi.fn(async (_address, _abi, method: string, args: bigint[]) => {
    if (method === "settle") { values.applied += args[0]!; values.remaining -= args[0]!; if (kind === "lp_deposit") values.shares = 173n; }
    if (method === "refund") values.refunded += args[0]!;
    return w("e");
  }) };
  const client = { ready: async () => {}, config: { chainId: 143, core: a("f"), apiBase: "https://api.example", settlementFactory: a("a") },
    signer: { address: () => a("1") }, rpc, settlement: { register } } as unknown as TermbookClient;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("/routes") ? [route] : {} })));
  return { client, input, route, wallet, values, register, rpc };
}
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.mocked(verifySourceRefund).mockResolvedValue(true); });
describe("remote payment completion", () => {
  it("permits a separate source wallet and confirms exact House allocation", async () => {
    const f = fixture();
    const result = await remotePayment(f.client, f.input, { sourceWallet: f.wallet, pollIntervalMs: 1 });
    expect(result).toMatchObject({ status: "applied", applied: 100n, remaining: 50n, shares: 0n });
    expect(f.wallet.fund).toHaveBeenCalledOnce();
    expect(verifyPaymentTransfer).toHaveBeenCalledWith(f.route, expect.anything(), w("c"), a("8"));
    expect(result.checkpoint.stage).toBe("complete");
  });
  it("does not report repayment from inbox receipts or resend an interrupted source transfer", async () => {
    const f = fixture(); f.rpc.client.simulateContract.mockRejectedValue(new Error("paused"));
    let checkpoint: PaymentCheckpoint | undefined;
    await expect(remotePayment(f.client, f.input, { sourceWallet: f.wallet, timeoutMs: 30, pollIntervalMs: 1,
      onProgress: (next) => { checkpoint = next; } })).rejects.toBeInstanceOf(PaymentPendingError);
    expect(f.values.applied).toBe(0n); expect(checkpoint?.sourceTx).toBe(w("c"));
    f.rpc.client.simulateContract.mockResolvedValue(undefined);
    const result = await remotePayment(f.client, f.input, { checkpoint, sourceWallet: f.wallet, pollIntervalMs: 1 });
    expect(result.applied).toBe(100n); expect(f.wallet.fund).toHaveBeenCalledOnce(); expect(f.register).toHaveBeenCalledOnce();
  });
  it("reports the actual minted LP shares rather than a pre-deposit estimate", async () => {
    const f = fixture("lp_deposit");
    const result = await remotePayment(f.client, f.input, { sourceWallet: f.wallet, pollIntervalMs: 1 });
    expect(result.shares).toBe(173n); expect(result.status).toBe("applied");
  });
  it("rejects a changed signed route before source funding", async () => {
    const f = fixture(); f.route.sourceAssetId = "other-token";
    // Alter the signed origin asset.
    const original = f.register.getMockImplementation()!;
    f.register.mockImplementation(async (...args) => {
      const registration = await original(...args); (registration["providerQuote"] as { quoteRequest: { originAsset: string } }).quoteRequest.originAsset = "wrong"; return registration;
    });
    await expect(remotePayment(f.client, f.input, { sourceWallet: f.wallet })).rejects.toMatchObject({ cause: { message: "settlement-quote-invalid" } });
    expect(f.wallet.fund).not.toHaveBeenCalled();
  });
  it("persists the registration transaction when the quote service fails", async () => {
    const f = fixture();
    f.register.mockImplementation(async (_input, options) => { await options.onSubmitted(w("a")); throw new Error("quote-unavailable"); });
    await expect(remotePayment(f.client, f.input, { sourceWallet: f.wallet })).rejects.toMatchObject({
      checkpoint: { registrationTx: w("a"), stage: "registered" }, cause: { message: "quote-unavailable" },
    });
    expect(f.wallet.fund).not.toHaveBeenCalled();
  });
  it("reports only confirmed partial allocation after the payment deadline", async () => {
    const f = fixture(); f.values.received = 60n; f.values.timestamp = BigInt(f.input.deadline + 601);
    const result = await remotePayment(f.client, f.input, { sourceWallet: f.wallet, pollIntervalMs: 1 });
    expect(result).toMatchObject({ status: "partial", applied: 60n, remaining: 90n }); expect(f.wallet.fund).not.toHaveBeenCalled();
  });
  it("reports a verified source refund after provider fees without waiting for the original gross input", async () => {
    const f = fixture();
    f.wallet.fund.mockImplementation(async (_r, _route, onSubmitted) => { await onSubmitted(w("c")); return w("c"); });
    vi.mocked(globalThis.fetch).mockImplementation(async (url) => ({ ok: true, json: async () => String(url).endsWith("/routes") ? [f.route] : {
      operationId: (await f.register.mock.results[0]!.value)["operationId"], inbox: a("9"), quote: {},
      providerStatus: "REFUNDED", providerStatusCheckedAt: Date.now(), providerRefundedAmount: "99", providerOriginTxHashes: [w("f")],
    } }) as Response);
    expect(await remotePayment(f.client, f.input, { sourceWallet: f.wallet })).toMatchObject({
      status: "refunded", applied: 0n, sourceRefunded: 99n, remaining: 150n,
    });
  });
  it("does not accept a provider refund report without a finalized source refund", async () => {
    const f = fixture(); f.values.received = 0n;
    f.wallet.fund.mockImplementation(async (_r, _route, onSubmitted) => { await onSubmitted(w("c")); return w("c"); });
    vi.mocked(verifySourceRefund).mockResolvedValue(false);
    const fetch = vi.mocked(globalThis.fetch);
    fetch.mockImplementation(async (url) => ({ ok: true, json: async () => String(url).endsWith("/routes") ? [f.route] : {
      operationId: (await f.register.mock.results[0]!.value)["operationId"], inbox: a("9"),
      quote: {}, providerStatus: "REFUNDED", providerStatusCheckedAt: Date.now(), providerRefundedAmount: "100",
      providerOriginTxHashes: [w("f")],
    } }) as Response);
    await expect(remotePayment(f.client, f.input, { sourceWallet: f.wallet, timeoutMs: 20, pollIntervalMs: 1 })).rejects.toBeInstanceOf(PaymentPendingError);
    expect(f.values.applied).toBe(0n); expect(verifySourceRefund).toHaveBeenCalled();
  });
});
