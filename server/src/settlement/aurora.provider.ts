import { verifyQuoteSignature, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { solanaBase58Bytes } from "../collateral/solana-proof.js";

export const auroraProductionOrigin = "https://1click.chaindefuser.com";

export function validateAuroraProvider(input: { apiUrl: string; publicKey: string; chainId: number }): URL {
  let endpoint: URL;
  try { endpoint = new URL(input.apiUrl); } catch { throw new Error("aurora-provider-config-invalid"); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port
    || endpoint.search || endpoint.hash || endpoint.pathname !== "/") throw new Error("aurora-provider-config-invalid");
  if ((endpoint.origin !== auroraProductionOrigin || input.publicKey) && input.chainId !== 10143) {
    throw new Error("aurora-sandbox-requires-testnet");
  }
  if (input.publicKey) {
    try { solanaBase58Bytes(input.publicKey.replace(/^ed25519:/, "")); }
    catch { throw new Error("aurora-quote-key-invalid"); }
  }
  return endpoint;
}

export function verifyAuroraProviderQuote(quote: OneClickQuoteResponse, publicKey: string): boolean {
  return verifyQuoteSignature(quote, publicKey || undefined);
}
