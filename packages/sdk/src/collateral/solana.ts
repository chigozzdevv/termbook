import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { solanaKeySchema } from "@termbook/schema";

const aliasDomain = keccak256(stringToHex("Termbook Solana alias v1"));
const base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function solanaPubkeyBytes(value: string): `0x${string}` {
  if (value.length < 32 || value.length > 44) throw new Error("solana-public-key-invalid");
  let number = 0n;
  for (const char of value) {
    const digit = base58.indexOf(char);
    if (digit < 0) throw new Error("solana-public-key-invalid");
    number = number * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(32);
  for (let index = 31; index >= 0; index--) {
    bytes[index] = Number(number & 255n);
    number >>= 8n;
  }
  if (number !== 0n) throw new Error("solana-public-key-invalid");
  const hex = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const parsed = solanaKeySchema.parse(hex);
  if (solanaPubkeyBase58(parsed) !== value) throw new Error("solana-public-key-invalid");
  return parsed;
}

export function solanaPubkeyBase58(value: `0x${string}`): string {
  const key = solanaKeySchema.parse(value);
  const bytes = key.slice(2).match(/.{2}/g)!.map((part) => Number.parseInt(part, 16));
  let number = BigInt(key);
  let encoded = "";
  while (number > 0n) {
    encoded = base58[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading++;
  return "1".repeat(leading) + encoded;
}

export function solanaAlias(genesis: `0x${string}`, id: `0x${string}`): `0x${string}` {
  const hash = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [aliasDomain, genesis, id],
  ));
  return `0x${hash.slice(-40)}`;
}
