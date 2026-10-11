"use client";

import { useCallback, useEffect, useState } from "react";
import { get, historySchema, marketSchema, type Market, type Trade } from "./data";

export function useMarket() {
  const [market, setMarket] = useState<Market>();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = marketSchema.parse(await get("/kuru/market", AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)])));
        if (Math.abs(Date.now() / 1000 - result.timestamp) > 30) throw new Error("Stale market data");
        if (active) { setMarket(result); setError(""); }
      } catch { if (active) setError("Market data is unavailable. Reconnecting…"); }
      if (active) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { active = false; abort.abort(); clearTimeout(timer); };
  }, [revision]);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = historySchema.parse(await get("/kuru/trades", AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)])));
        if (active) { setTrades(result.trades); setHistoryError(""); }
      } catch { if (active) setHistoryError("Trade history is unavailable."); }
      if (active) timer = setTimeout(poll, 15_000);
    }
    void poll();
    return () => { active = false; abort.abort(); clearTimeout(timer); };
  }, [revision]);
  return { market, trades, error, historyError, refresh };
}
