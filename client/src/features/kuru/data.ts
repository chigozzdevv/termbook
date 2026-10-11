import { z } from "zod";

export const apiBase = (process.env.NEXT_PUBLIC_TERMBOOK_API_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
const decimal = z.string().regex(/^\d+(?:\.\d{1,18})?$/);
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const level = z.object({ price: decimal, size: decimal });
export const marketSchema = z.object({
  chain_id: z.literal(10143), market_id: address, address,
  base_asset: z.literal("0x0000000000000000000000000000000000000000"), quote_asset: address,
  base_decimals: z.literal(18), quote_decimals: z.literal(6), block: z.string().regex(/^\d+$/),
  timestamp: z.number().int().positive(), state: z.number().int().min(0), fee_bps: z.number().int().min(0).max(9999),
  maximum_buy: decimal, app_token: z.string().regex(/^tbk_[a-f0-9]{64}$/).nullable(),
  version_id: z.string().regex(/^0x[a-fA-F0-9]{64}$/), order_types: z.array(z.enum(["market", "limit"])).min(1).max(2), price_tick: decimal,
  bids: z.array(level).max(16), asks: z.array(level).max(16),
});
const tradeSchema = z.object({ id: z.string(), tx: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  block: z.string().regex(/^\d+$/), time: z.number().int().positive(), direction: z.enum(["buy", "sell"]), price: decimal, size: decimal });
export const historySchema = z.object({ trades: z.array(tradeSchema).max(2000), through: z.string().regex(/^\d+$/) });
export type Market = z.infer<typeof marketSchema>;
export type Trade = z.infer<typeof tradeSchema>;
export type Level = z.infer<typeof level>;

export async function get(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${apiBase}${path}`, { signal: signal ?? AbortSignal.timeout(20_000), cache: "no-store" });
  if (!response.ok) throw new Error("The Termbook service is unavailable. Try again.");
  return response.json();
}

export function number(value: string | number, digits = 6) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
}
export function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
export const explorer = "https://testnet.monadexplorer.com";
