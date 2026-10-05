import { type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { describe, expect, it } from "vitest";
import { auroraProductionOrigin, auroraProviderEndpoint, validateAuroraApiKey, validateAuroraProvider, verifyAuroraProviderQuote } from "../../src/settlement/aurora.provider.js";
import { auroraTestSigner } from "./aurora.fixture.js";

describe("Aurora provider trust", () => {
  it("keeps the production endpoint and SDK key as the defaults", () => {
    expect(auroraProductionOrigin).toBe("https://intents-api.aurora.dev");
    expect(validateAuroraProvider({ apiUrl: auroraProductionOrigin, publicKey: "", chainId: 143 }).origin).toBe(auroraProductionOrigin);
  });

  it("uses Studio keys as encoded path segments for Aurora operations", () => {
    for (const operation of ["quote", "status"] as const) {
      const endpoint = auroraProviderEndpoint({ apiUrl: auroraProductionOrigin, publicKey: "", chainId: 143, apiKey: "studio/key?#%" }, operation);
      expect(endpoint.href).toBe(`https://intents-api.aurora.dev/api/${operation}/studio%2Fkey%3F%23%25`);
    }
    for (const apiKey of ["", ".", "..", "key\n", " key", "\u0000", "\ud800", "k".repeat(2049)]) {
      expect(() => validateAuroraApiKey(apiKey)).toThrow("aurora-api-key-invalid");
    }
  });

  it("rejects direct 1Click origins on both networks", () => {
    for (const chainId of [143, 10143]) {
      expect(() => validateAuroraProvider({ apiUrl: "https://1click.chaindefuser.com", publicKey: "", chainId })).toThrow("aurora-provider-config-invalid");
    }
  });

  it("rejects sandbox overrides outside Monad testnet and credential-bearing URLs", () => {
    for (const chainId of [143, 1, 31337]) {
      expect(() => validateAuroraProvider({ apiUrl: "https://sandbox.example", publicKey: "", chainId })).toThrow("aurora-sandbox-requires-testnet");
    }
    for (const apiUrl of ["http://sandbox.example", "https://secret@sandbox.example", "https://sandbox.example/?key=secret", "https://sandbox.example/path", "https://sandbox.example:8443"]) {
      expect(() => validateAuroraProvider({ apiUrl, publicKey: "", chainId: 10143 })).toThrow("aurora-provider-config-invalid");
    }
  });

  it("accepts only a real signature from the pinned sandbox key", () => {
    const signer = auroraTestSigner();
    const publicKey = signer.publicKey;
    const quote = signer.sign({ quoteRequest: { dry: false, swapType: "EXACT_INPUT", amount: "100", originAsset: "test:eth", destinationAsset: "test:usdc" },
      quote: { amountIn: "100", amountOut: "99", minAmountOut: "98", depositAddress: `0x${"11".repeat(20)}` },
      timestamp: "2026-10-03T00:00:00.000Z", signature: "" } as unknown as OneClickQuoteResponse);
    validateAuroraProvider({ apiUrl: "https://sandbox.example", publicKey, chainId: 10143 });
    expect(verifyAuroraProviderQuote(quote, publicKey)).toBe(true);
    expect(verifyAuroraProviderQuote(quote, "")).toBe(false);
    expect(() => validateAuroraProvider({ apiUrl: auroraProductionOrigin, publicKey, chainId: 143 })).toThrow("aurora-sandbox-requires-testnet");
    expect(verifyAuroraProviderQuote({ ...quote, quote: { ...quote.quote, amountOut: "100" } }, publicKey)).toBe(false);
    expect(() => validateAuroraProvider({ apiUrl: "https://sandbox.example", publicKey: "invalid", chainId: 10143 })).toThrow("aurora-quote-key-invalid");
  });
});
