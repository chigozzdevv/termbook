import { parseUnits, formatUnits } from "viem";
import type { Level, Market, Trade } from "./data";

export function amountUnits(text: string, decimals: number): bigint | undefined {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(text) || text.length > 80) return undefined;
  const value = parseUnits(text, decimals);
  return value > 0n && value < 2n ** 128n ? value : undefined;
}

export function estimate(market: Pick<Market, "asks" | "bids" | "fee_bps">, direction: "buy" | "sell", amount: bigint, slippage: number) {
  if (amount <= 0n || !Number.isInteger(slippage) || slippage < 0 || slippage > 5000) return undefined;
  let remaining = direction === "buy" ? amount * 10n ** 12n : amount, output = 0n;
  for (const level of direction === "buy" ? market.asks : market.bids) {
    const price = parseUnits(level.price, 18), size = parseUnits(level.size, 18);
    if (price <= 0n || size <= 0n) continue;
    if (direction === "buy") {
      const cost = size * price / 10n ** 18n;
      const spend = remaining < cost ? remaining : cost;
      output += spend * 10n ** 18n / price;
      remaining -= spend;
    } else {
      const sell = remaining < size ? remaining : size;
      output += sell * price / 10n ** 18n;
      remaining -= sell;
    }
    if (remaining === 0n) break;
  }
  if (remaining > 0n) return undefined;
  output = output * BigInt(10_000 - market.fee_bps) / 10_000n;
  if (direction === "sell") output /= 10n ** 12n;
  const decimals = direction === "buy" ? 18 : 6;
  return { output: formatUnits(output, decimals), minimum: formatUnits(output * BigInt(10_000 - slippage) / 10_000n, decimals) };
}

export function cumulative(levels: Level[]) {
  let total = 0;
  return levels.map((level) => ({ ...level, total: total += Number(level.size) }));
}

export function candles(trades: Trade[], minutes: number) {
  const buckets = new Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number }>();
  for (const trade of [...trades].sort((a, b) => a.time - b.time || (BigInt(a.block) < BigInt(b.block) ? -1 : BigInt(a.block) > BigInt(b.block) ? 1 : Number(a.id.split(":").at(-1)) - Number(b.id.split(":").at(-1))))) {
    const price = Number(trade.price), volume = Number(trade.size), time = Math.floor(trade.time / (minutes * 60)) * minutes * 60;
    if (!Number.isFinite(price) || !Number.isFinite(volume) || price <= 0 || volume <= 0) continue;
    const candle = buckets.get(time);
    if (candle) { candle.high = Math.max(candle.high, price); candle.low = Math.min(candle.low, price); candle.close = price; candle.volume += volume; }
    else buckets.set(time, { time, open: price, high: price, low: price, close: price, volume });
  }
  return [...buckets.values()];
}

export function chartTimeline(bars: ReturnType<typeof candles>, minutes: number) {
  if (!bars.length || !Number.isInteger(minutes) || minutes <= 0) return [];
  const step = minutes * 60, last = bars.at(-1)!.time;
  const first = Math.max(bars[0].time, last - 2000 * step);
  const byTime = new Map(bars.map((bar) => [bar.time, bar]));
  const points: (ReturnType<typeof candles>[number] | { time: number })[] = [];
  for (let time = first; time <= last; time += step) points.push(byTime.get(time) ?? { time });
  return points;
}
