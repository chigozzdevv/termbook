import { z } from "zod";

export const chartMarket = "0x065c9d28e428a0db40191a54d33d5b7c71a9c394";
const resolutions = new Map([[1, "1m"], [5, "5m"], [15, "15m"], [60, "1h"]]);
const decimal = z.string().max(80).regex(/^\d+(?:\.\d{1,36})?$/).refine((value) => Number.isFinite(Number(value)));
const values = z.array(decimal).max(500);
const history = z.object({ success: z.literal(true), timestamp: z.number().int().positive(),
  data: z.object({ data: z.union([
    z.object({ s: z.literal("no_data") }),
    z.object({ s: z.literal("ok"), t: z.array(z.number().int().positive()).max(500),
      o: values, h: values, l: values, c: values, v: values }),
  ]) }),
});
type Candle = { time: number; open: string; high: string; low: string; close: string; volume: string };
type Chart = { chain_id: number; market_id: string; interval: number; timestamp: number; source_url: string; candles: Candle[] };
const cache = new Map<number, { data?: Chart; expires: number; pending?: Promise<Chart> }>();

async function load(interval: number, resolution: string): Promise<Chart> {
  const now = Math.floor(Date.now() / 1000), step = interval * 60;
  const from = Math.floor(now / step) * step - 499 * step;
  const query = new URLSearchParams({ countback: "500", from: String(from), to: String(now),
    resolution, isDollar: "false", inMarketCap: "false" });
  const response = await fetch(`https://api.kuru.io/api/v2/${chartMarket}/trades/history?${query}`,
    { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("kuru-chart-unavailable");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 262_144) throw new Error("kuru-chart-response-invalid");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = history.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const timestamp = Math.floor(result.timestamp / 1000);
  if (Math.abs(Date.now() / 1000 - timestamp) > 60) throw new Error("kuru-chart-stale");
  const series = result.data.data, candles: Candle[] = [];
  if (series.s === "ok") {
    if ([series.o, series.h, series.l, series.c, series.v].some((values) => values.length !== series.t.length)) {
      throw new Error("kuru-chart-response-invalid");
    }
    let previous = 0;
    for (let index = 0; index < series.t.length; index++) {
      const time = series.t[index]!;
      const bar = { time, open: series.o[index]!, high: series.h[index]!, low: series.l[index]!,
        close: series.c[index]!, volume: series.v[index]! };
      const [open, high, low, close, volume] = [bar.open, bar.high, bar.low, bar.close, bar.volume].map(Number);
      if (time <= previous || time % step !== 0 || time < from || time > now || low! <= 0 || open! <= 0
        || high! < low! || close! > high! || close! < low! || volume! < 0) {
        throw new Error("kuru-chart-candle-invalid");
      }
      // Kuru's opening price can precede the candle's traded range.
      if (open! > high!) bar.high = bar.open;
      if (open! < low!) bar.low = bar.open;
      previous = time;
      candles.push(bar);
    }
  }
  return { chain_id: 143, market_id: chartMarket, interval, timestamp,
    source_url: `https://www.kuru.io/markets/${chartMarket}/trade`, candles };
}

export async function marketChart(interval: number): Promise<Chart> {
  const resolution = resolutions.get(interval);
  if (!resolution) throw new Error("kuru-chart-interval-invalid");
  const existing = cache.get(interval);
  if (existing?.pending) return existing.pending;
  if (existing && existing.expires > Date.now()) {
    if (existing.data) return existing.data;
    throw new Error("kuru-chart-unavailable");
  }
  const entry: { data?: Chart; expires: number; pending?: Promise<Chart> } = { expires: 0 };
  cache.set(interval, entry);
  entry.pending = load(interval, resolution).then((data) => {
    entry.data = data; entry.expires = Date.now() + 10_000; return data;
  }, (error: unknown) => {
    entry.expires = Date.now() + 5000; throw error;
  }).finally(() => { entry.pending = undefined; });
  return entry.pending;
}
