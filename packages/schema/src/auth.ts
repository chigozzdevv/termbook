import { z } from "zod";

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const bigintSchema = z
  .union([z.bigint(), z.string().regex(/^\d+$/)])
  .transform((v) => BigInt(v));

export type ApiAuthorization = { method: "POST"; path: string; bodyHash: string };

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    }
    return item;
  }) ?? "null";
}

export function apiAuthorizationMessage(domain: string, wallet: string, nonce: string,
  expiresAt: number, request: ApiAuthorization): string {
  return ["Termbook API request", `Domain: ${domain}`, `Wallet: ${wallet.toLowerCase()}`,
    `Nonce: ${nonce}`, `Expires: ${expiresAt}`, `Method: ${request.method}`,
    `Path: ${request.path}`, `Body: ${request.bodyHash}`].join("\n");
}
