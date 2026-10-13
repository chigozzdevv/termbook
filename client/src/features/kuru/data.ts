import { z } from "zod";
import { env } from "@/lib/env";
import { protocol } from "@/lib/api";

export const apiBase = env.protocolApiUrl;
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
export const chartSource = "https://www.kuru.io/markets/0x065c9d28e428a0db40191a54d33d5b7c71a9c394/trade";
const chartDecimal = z.string().max(80).regex(/^\d+(?:\.\d{1,36})?$/);
export const chartSchema = z.object({
  chain_id: z.literal(143), market_id: z.literal("0x065c9d28e428a0db40191a54d33d5b7c71a9c394"),
  interval: z.union([z.literal(1), z.literal(5), z.literal(15), z.literal(60)]), source_url: z.literal(chartSource),
  timestamp: z.number().int().positive(),
  candles: z.array(z.object({ time: z.number().int().positive(), open: chartDecimal, high: chartDecimal,
    low: chartDecimal, close: chartDecimal, volume: chartDecimal })).max(500),
}).superRefine((data, context) => {
  let previous = 0;
  for (const bar of data.candles) {
    const [open, high, low, close, volume] = [bar.open, bar.high, bar.low, bar.close, bar.volume].map(Number);
    if (![open, high, low, close, volume].every(Number.isFinite) || low <= 0 || high < Math.max(open, close)
      || low > Math.min(open, close) || volume < 0 || bar.time <= previous || bar.time % (data.interval * 60) !== 0
      || bar.time > data.timestamp) {
      context.addIssue({ code: "custom", message: "Invalid chart candle" }); break;
    }
    previous = bar.time;
  }
});
export type Market = z.infer<typeof marketSchema>;
export type Trade = z.infer<typeof tradeSchema>;
export type Level = z.infer<typeof level>;

export async function get(path: string, signal?: AbortSignal): Promise<unknown> {
  return protocol(path, signal);
}

export function number(value: string | number, digits = 6) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
}
export function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
export const explorer = "https://testnet.monadexplorer.com";
