"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, HistogramSeries, createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { candles } from "./amount";
import type { Trade } from "./data";

export function Chart({ trades, error }: { trades: Trade[]; error: string }) {
  const [interval, setInterval] = useState(15);
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fitted = useRef(false);
  const bars = useMemo(() => candles(trades, interval), [trades, interval]);
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      autoSize: true, height: 390,
      layout: { background: { type: ColorType.Solid, color: "#101213" }, textColor: "#93999d", fontFamily: "Inter, sans-serif", attributionLogo: true },
      grid: { vertLines: { color: "#1b1e20" }, horzLines: { color: "#1b1e20" } },
      crosshair: { vertLine: { color: "#666a74", labelBackgroundColor: "#34343f" }, horzLine: { color: "#666a74", labelBackgroundColor: "#34343f" } },
      rightPriceScale: { borderColor: "#2b2e30", scaleMargins: { top: .12, bottom: .25 } },
      timeScale: { borderColor: "#2b2e30", timeVisible: true, secondsVisible: false, rightOffset: 4 },
    });
    api.current = chart;
    series.current = chart.addSeries(CandlestickSeries, { upColor: "#00d578", downColor: "#ff7581", borderVisible: false,
      wickUpColor: "#00d578", wickDownColor: "#ff7581", priceFormat: { type: "price", precision: 6, minMove: .000001 } });
    volume.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: .84, bottom: 0 }, visible: false });
    return () => { chart.remove(); api.current = null; series.current = null; volume.current = null; fitted.current = false; };
  }, []);
  useEffect(() => { fitted.current = false; }, [interval]);
  useEffect(() => {
    series.current?.setData(bars.map(({ time, open, high, low, close }) => ({ time: time as UTCTimestamp, open, high, low, close })));
    volume.current?.setData(bars.map((bar) => ({ time: bar.time as UTCTimestamp, value: bar.volume, color: bar.close >= bar.open ? "#00d57830" : "#ff758130" })));
    if (bars.length && !fitted.current) { api.current?.timeScale().fitContent(); fitted.current = true; }
  }, [bars]);
  return <section className="kuru-chart" aria-label="MON USDC price chart">
    <header className="kuru-chart-toolbar"><div role="group" aria-label="Chart interval">
      {[[1, "1m"], [5, "5m"], [15, "15m"], [60, "1h"]].map(([value, label]) => <button key={value} type="button" aria-pressed={interval === value} onClick={() => setInterval(Number(value))}>{label}</button>)}
    </div><span>MON / USDC</span></header>
    <div className="kuru-chart-area"><div ref={container} className="kuru-chart-canvas" />
      {!bars.length && <p className="kuru-chart-empty" role="status">{error || "No recent trades in this market."}</p>}
    </div>
    {error && bars.length > 0 && <p className="kuru-error" role="status">{error}</p>}
  </section>;
}
