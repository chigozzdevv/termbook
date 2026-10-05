import { generateKeyPairSync, sign } from "node:crypto";
import { quoteHash, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let result = "";
  while (number > 0n) { result = alphabet[Number(number % 58n)] + result; number /= 58n; }
  let leading = 0;
  while (bytes[leading] === 0) leading++;
  return "1".repeat(leading) + result;
}

export function auroraTestSigner() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKey: `ed25519:${base58(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32))}`,
    sign(quote: OneClickQuoteResponse): OneClickQuoteResponse {
      return { ...quote, signature: `ed25519:${base58(sign(null, Buffer.from(quoteHash(quote)), pair.privateKey))}` };
    },
  };
}
