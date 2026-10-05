import { type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { requestAuroraQuote, requestAuroraStatus, type AuroraRoute } from "../../src/settlement/aurora.client.js";
import { auroraProductionOrigin } from "../../src/settlement/aurora.provider.js";
import { auroraTestSigner } from "./aurora.fixture.js";

const original = { apiUrl: env.auroraApiUrl, chainId: env.monadChainId, apiKey: env.auroraApiKey, publicKey: env.auroraQuotePublicKey };
const signer = auroraTestSigner();
const a = (digit: string) => `0x${digit.repeat(40)}`;
const route: AuroraRoute = {
  routeId: `0x${"11".repeat(32)}`, routeVersion: `0x${"22".repeat(32)}`,
  kind: "recovery", sourceChain: 1, sourceAsset: a("3"),
  sourceAssetId: "eth:weth", destinationAssetId: "monad:usdc",
  vault: a("4"), token: a("5"), maxAmountIn: "100", slippageBps: 100,
  sourceAddressFormat: "evm", recoveryVault: a("6"),
};
const input = () => ({ route, inbox: a("8"), amountIn: "100", minAmountOut: "80", maxReceived: "120",
  sourceRefundRecipient: a("6"), deadline: Math.floor(Date.now() / 1000) + 600 });

function signedQuote(request: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const echoed = { dry: false, swapType: "EXACT_INPUT", amount: "100", originAsset: route.sourceAssetId,
    destinationAsset: route.destinationAssetId, depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN", recipient: a("8"), refundTo: a("6"), slippageTolerance: 100,
    deadline: new Date(input().deadline * 1000).toISOString(), ...request };
  return signer.sign({ timestamp: new Date().toISOString(), signature: "", quoteRequest: echoed,
    quote: { depositAddress: a("7"), amountIn: "100", amountOut: "90", minAmountOut: "90",
      deadline: echoed.deadline, ...overrides },
  } as unknown as OneClickQuoteResponse);
}

beforeEach(() => {
  env.monadChainId = 10143;
  env.auroraApiUrl = auroraProductionOrigin;
  env.auroraApiKey = "studio-key";
  env.auroraQuotePublicKey = signer.publicKey;
});

afterEach(() => {
  env.auroraApiKey = original.apiKey;
  env.auroraApiUrl = original.apiUrl;
  env.monadChainId = original.chainId;
  env.auroraQuotePublicKey = original.publicKey;
  vi.unstubAllGlobals();
});

describe("Aurora quote admission", () => {
  it.each(["repay", "recovery", "lp_deposit"] as const)("requests a signed %s quote through Aurora with Studio authentication", async (kind) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => {
      const request = JSON.parse(options!.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(signedQuote(request)));
    });
    vi.stubGlobal("fetch", fetch);
    const quote = await requestAuroraQuote({ ...input(), route: { ...route, kind } });
    expect(quote.quote.amountOut).toBe("90");
    expect(String(fetch.mock.calls[0]![0])).toBe("https://intents-api.aurora.dev/api/quote/studio-key");
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "POST", redirect: "error", headers: { "Content-Type": "application/json" } });
    expect(fetch.mock.calls[0]![1]!.headers).not.toHaveProperty("X-API-Key");
    expect(fetch.mock.calls[0]![1]!.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({
      amount: "100", originAsset: route.sourceAssetId, destinationAsset: route.destinationAssetId,
      recipient: a("8"), refundTo: a("6"), depositMode: "SIMPLE",
    });
  });

  it("sends sandbox status requests only to the configured origin without following redirects", async () => {
    env.auroraApiUrl = "https://sandbox.example";
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(requestAuroraStatus({ quote: { depositAddress: a("7") } } as never)).rejects.toThrow("aurora-status-unavailable");
    expect(String(fetch.mock.calls[0]![0])).toBe(`https://sandbox.example/api/status/studio-key?depositAddress=${a("7")}`);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
    expect(fetch.mock.calls[0]![1]!.headers).toBeUndefined();
  });

  it("rejects a signed quote with an unparseable deadline", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>(async (_url, options) => {
      return new Response(JSON.stringify(signedQuote(JSON.parse(options!.body as string), { deadline: "invalid-date" })));
    }));
    await expect(requestAuroraQuote(input())).rejects.toThrow("aurora-quote-invalid");
  });

  it("rejects altered signatures and a validly signed quote for another inbox", async () => {
    for (const differentInbox of [false, true]) {
      vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>(async (_url, options) => {
        const request = JSON.parse(options!.body as string);
        if (differentInbox) request.recipient = a("9");
        const quote = signedQuote(request);
        if (!differentInbox) quote.quote.amountOut = "100";
        return new Response(JSON.stringify(quote));
      }));
      await expect(requestAuroraQuote(input())).rejects.toThrow("aurora-quote-invalid");
    }
  });

  it.each(["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"])("tracks %s against the signed quote and handles nullable refunds", async (status) => {
    const quote = signedQuote({ ...input(), deadline: new Date(input().deadline * 1000).toISOString() });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      status, quoteResponse: quote, swapDetails: { refundedAmount: status === "REFUNDED" ? "100" : null,
        originChainTxHashes: [{ hash: "source-tx" }], destinationChainTxHashes: [{ hash: "monad-tx" }] },
    })));
    vi.stubGlobal("fetch", fetch);
    await expect(requestAuroraStatus(quote)).resolves.toEqual({ status, refundedAmount: status === "REFUNDED" ? "100" : "0",
      originTxHashes: ["source-tx"], destinationTxHashes: ["monad-tx"] });
    expect(String(fetch.mock.calls[0]![0])).toBe(`https://intents-api.aurora.dev/api/status/studio-key?depositAddress=${a("7")}`);
  });

  it("rejects status for a different signed quote or a status without its quote", async () => {
    const quote = signedQuote({ deadline: new Date(input().deadline * 1000).toISOString() });
    for (const response of [
      { status: "SUCCESS", quoteResponse: signer.sign({ ...quote, quote: { ...quote.quote, amountOut: "100" } }), swapDetails: {} },
      { status: "SUCCESS" },
    ]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response))));
      await expect(requestAuroraStatus(quote)).rejects.toThrow("aurora-status-invalid");
    }
  });

  it("does not send requests without a Studio key", async () => {
    env.auroraApiKey = "";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(requestAuroraQuote(input())).rejects.toThrow("aurora-api-key-invalid");
    expect(fetch).not.toHaveBeenCalled();
  });
});
