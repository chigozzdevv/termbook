import { generateKeyPairSync, sign } from "node:crypto";
import { quoteHash, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { describe, expect, it } from "vitest";
import { auroraProductionOrigin, validateAuroraProvider, verifyAuroraProviderQuote } from "../../src/settlement/aurora.provider.js";

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let result = "";
  while (number > 0n) { result = alphabet[Number(number % 58n)] + result; number /= 58n; }
  let leading = 0;
  while (bytes[leading] === 0) leading++;
  return "1".repeat(leading) + result;
}

describe("Aurora provider trust", () => {
  it("keeps the production endpoint and SDK key as the defaults", () => {
    expect(validateAuroraProvider({ apiUrl: auroraProductionOrigin, publicKey: "", chainId: 143 }).origin).toBe(auroraProductionOrigin);
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
    const pair = generateKeyPairSync("ed25519");
    const publicKey = `ed25519:${base58(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32))}`;
    const quote = { quoteRequest: { dry: false, swapType: "EXACT_INPUT", amount: "100", originAsset: "test:eth", destinationAsset: "test:usdc" },
      quote: { amountIn: "100", amountOut: "99", minAmountOut: "98", depositAddress: `0x${"11".repeat(20)}` },
      timestamp: "2026-10-03T00:00:00.000Z", signature: "" } as unknown as OneClickQuoteResponse;
    quote.signature = `ed25519:${base58(sign(null, Buffer.from(quoteHash(quote)), pair.privateKey))}`;
    validateAuroraProvider({ apiUrl: "https://sandbox.example", publicKey, chainId: 10143 });
    expect(verifyAuroraProviderQuote(quote, publicKey)).toBe(true);
    expect(verifyAuroraProviderQuote(quote, "")).toBe(false);
    expect(() => validateAuroraProvider({ apiUrl: auroraProductionOrigin, publicKey, chainId: 143 })).toThrow("aurora-sandbox-requires-testnet");
    expect(verifyAuroraProviderQuote({ ...quote, quote: { ...quote.quote, amountOut: "100" } }, publicKey)).toBe(false);
    expect(() => validateAuroraProvider({ apiUrl: "https://sandbox.example", publicKey: "invalid", chainId: 10143 })).toThrow("aurora-quote-key-invalid");
  });
});
