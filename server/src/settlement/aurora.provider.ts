import { verifyQuoteSignature, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { solanaBase58Bytes } from "../collateral/solana-proof.js";

export const auroraProductionOrigin = "https://intents-api.aurora.dev";

export function validateAuroraProvider(input: { apiUrl: string; publicKey: string; chainId: number }): URL {
  let endpoint: URL;
  try { endpoint = new URL(input.apiUrl); } catch { throw new Error("aurora-provider-config-invalid"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port
    || endpoint.search || endpoint.hash || endpoint.pathname !== "/"
    || endpoint.hostname === "1click.chaindefuser.com") throw new Error("aurora-provider-config-invalid");
  if ((endpoint.origin !== auroraProductionOrigin || input.publicKey) && input.chainId !== 10143) {
    throw new Error("aurora-sandbox-requires-testnet");
  }
  if (input.publicKey) {
    try { solanaBase58Bytes(input.publicKey.replace(/^ed25519:/, "")); }
    catch { throw new Error("aurora-quote-key-invalid"); }
  }
  return endpoint;
}

export function validateAuroraApiKey(apiKey: string): void {
  if (!apiKey || apiKey.length > 2048 || /\s/.test(apiKey)
    || Array.from(apiKey).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || apiKey === "." || apiKey === "..") throw new Error("aurora-api-key-invalid");
  try { encodeURIComponent(apiKey); } catch { throw new Error("aurora-api-key-invalid"); }
}

export function auroraProviderEndpoint(
  input: { apiUrl: string; publicKey: string; chainId: number; apiKey: string },
  operation: "quote" | "status",
): URL {
  const origin = validateAuroraProvider(input);
  validateAuroraApiKey(input.apiKey);
  return new URL(`/api/${operation}/${encodeURIComponent(input.apiKey)}`, origin);
}

export function verifyAuroraProviderQuote(quote: OneClickQuoteResponse, publicKey: string): boolean {
  return verifyQuoteSignature(quote, publicKey || undefined);
}
