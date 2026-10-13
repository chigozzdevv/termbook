"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, HistogramSeries, createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp, type MouseEventParams } from "lightweight-charts";
import { ArrowUpRight } from "lucide-react";
import { chartTimeline } from "./amount";
import { get, chartSchema, chartSource } from "./data";
import type { candles } from "./amount";

function useChart(interval: number) {
  const [data, setData] = useState<{ interval: number; bars: ReturnType<typeof candles> }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = chartSchema.parse(await get(`/kuru/chart?interval=${interval}`, AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)])));
        if (result.interval !== interval || Math.abs(Date.now() / 1000 - result.timestamp) > 60) throw new Error("Stale price chart");
        if (active) {
          setData({ interval, bars: result.candles.map((bar) => ({ time: bar.time, open: Number(bar.open), high: Number(bar.high),
            low: Number(bar.low), close: Number(bar.close), volume: Number(bar.volume) })) });
          setError("");
        }
      } catch { if (active) setError("Price chart is unavailable. Reconnecting…"); }
      if (active) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { active = false; abort.abort(); clearTimeout(timer); };
  }, [interval]);
  return { bars: data?.interval === interval ? data.bars : undefined, error };
}

export function Chart() {
  const [interval, setInterval] = useState(15);
  const data = useChart(interval);
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLegend = useRef<HTMLDivElement>(null);
  const volumeLegend = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const bars = useMemo(() => data.bars ?? [], [data.bars]);
  const points = useMemo(() => chartTimeline(bars, interval), [bars, interval]);
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      autoSize: true, height: 390,
      layout: { background: { type: ColorType.Solid, color: "#101213" }, textColor: "#93999d", fontFamily: "Inter, sans-serif", attributionLogo: true,
        panes: { separatorColor: "#2b2e30", separatorHoverColor: "#2b2e30", enableResize: false } },
      grid: { vertLines: { color: "#1b1e20" }, horzLines: { color: "#1b1e20" } },
      crosshair: { vertLine: { color: "#666a74", labelBackgroundColor: "#34343f" }, horzLine: { color: "#666a74", labelBackgroundColor: "#34343f" } },
      rightPriceScale: { borderColor: "#2b2e30", scaleMargins: { top: .16, bottom: .08 } },
      timeScale: { borderColor: "#2b2e30", timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, maxBarSpacing: 14 },
    });
    api.current = chart;
    series.current = chart.addSeries(CandlestickSeries, { upColor: "#00d578", downColor: "#ff7581", borderVisible: false,
      wickUpColor: "#00d578", wickDownColor: "#ff7581", priceFormat: { type: "price", precision: 6, minMove: .000001 } });
    volume.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }, 1);
    chart.priceScale("right", 1).applyOptions({ scaleMargins: { top: .3, bottom: .02 } });
    chart.panes()[0].setStretchFactor(4);
    chart.panes()[1].setStretchFactor(1);
    return () => { chart.remove(); api.current = null; series.current = null; volume.current = null; fitted.current = false; };
  }, []);
  useEffect(() => { fitted.current = false; }, [interval]);
  useEffect(() => {
    series.current?.setData(points.map((bar) => "open" in bar
      ? { time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close }
      : { time: bar.time as UTCTimestamp }));
    volume.current?.setData(points.map((bar) => "volume" in bar
      ? { time: bar.time as UTCTimestamp, value: bar.volume, color: bar.close >= bar.open ? "#00d57880" : "#ff758180" }
      : { time: bar.time as UTCTimestamp }));
    if (points.length && !fitted.current) {
      api.current?.timeScale().setVisibleLogicalRange({ from: points.length - 100, to: points.length + 6 });
      fitted.current = true;
    }
    const chart = api.current, price = series.current, histogram = volume.current;
    if (!chart || !price || !histogram) return;
    const show = (bar: ReturnType<typeof candles>[number] | undefined) => {
      if (priceLegend.current) priceLegend.current.textContent = bar
        ? `O ${bar.open.toFixed(6)}   H ${bar.high.toFixed(6)}   L ${bar.low.toFixed(6)}   C ${bar.close.toFixed(6)}` : "";
      if (volumeLegend.current) {
        volumeLegend.current.textContent = `Volume${bar ? `  ${bar.volume.toLocaleString("en-US", { maximumFractionDigits: 4 })}` : ""}`;
        volumeLegend.current.style.top = `${chart.panes()[0].getHeight() + 8}px`;
      }
    };
    show(bars.at(-1));
    const crosshair = (event: MouseEventParams) => {
      show(event.time === undefined ? bars.at(-1) : bars.find((bar) => bar.time === event.time));
    };
    chart.subscribeCrosshairMove(crosshair);
    return () => { if (api.current === chart) chart.unsubscribeCrosshairMove(crosshair); };
  }, [bars, points]);
  return <section className="kuru-chart" aria-label="MON USDC price chart">
    <header className="kuru-chart-toolbar"><div role="group" aria-label="Chart interval">
      {[[1, "1m"], [5, "5m"], [15, "15m"], [60, "1h"]].map(([value, label]) => <button key={value} type="button" aria-pressed={interval === value} onClick={() => setInterval(Number(value))}>{label}</button>)}
    </div><a href={chartSource} target="_blank" rel="noopener noreferrer" title="Kuru MON/USDC · Monad mainnet" aria-label="Open Kuru’s MON/USDC chart on Monad mainnet">MON / USDC<ArrowUpRight size={12} /></a></header>
    <div className="kuru-chart-area"><div ref={container} className="kuru-chart-canvas" />
      <div ref={priceLegend} className="kuru-price-legend" />
      <div ref={volumeLegend} className="kuru-volume-legend" />
      {!bars.length && <p className="kuru-chart-empty" role="status">{data.error || (data.bars ? "No trade history available." : "Loading price chart…")}</p>}
    </div>
    {data.error && bars.length > 0 && <p className="kuru-error" role="status">{data.error}</p>}
  </section>;
}
