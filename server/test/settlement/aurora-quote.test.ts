import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { requestAuroraQuote, type AuroraRoute } from "../../src/settlement/aurora.client.js";

vi.mock("@defuse-protocol/one-click-sdk-typescript", () => ({
  verifyQuoteSignature: vi.fn(() => true),
  quoteHash: vi.fn(() => "signed-quote"),
}));

afterEach(() => {
  env.auroraApiKey = "";
  vi.unstubAllGlobals();
});

describe("Aurora quote admission", () => {
  it("rejects a signed quote with an unparseable deadline", async () => {
    env.auroraApiKey = "test-key";
    const route = {
      routeId: `0x${"11".repeat(32)}`, routeVersion: `0x${"22".repeat(32)}`,
      kind: "recovery", sourceChain: 1, sourceAsset: `0x${"33".repeat(20)}`,
      sourceAssetId: "eth:weth", destinationAssetId: "monad:usdc",
      vault: `0x${"44".repeat(20)}`, token: `0x${"55".repeat(20)}`,
      maxAmountIn: "100", slippageBps: 100, sourceAddressFormat: "evm",
      recoveryVault: `0x${"66".repeat(20)}`,
    } as AuroraRoute;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      const request = JSON.parse(options.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({ quoteRequest: request, quote: {
        depositAddress: `0x${"77".repeat(20)}`, amountIn: "100",
        amountOut: "90", minAmountOut: "90", deadline: "invalid-date",
      } }));
    }));
    await expect(requestAuroraQuote({ route, inbox: `0x${"88".repeat(20)}`,
      amountIn: "100", minAmountOut: "80", maxReceived: "120",
      sourceRefundRecipient: route.recoveryVault!, deadline: Math.floor(Date.now() / 1000) + 600,
    })).rejects.toThrow("aurora-quote-invalid");
  });
});
