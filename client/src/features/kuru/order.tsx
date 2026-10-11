"use client";

import { useState } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import type { OpenOptions } from "@termbook/sdk";
import { Button } from "@/components/ui/button";
import { amountUnits, estimate } from "./amount";
import { number, type Market } from "./data";
import type { AccountView } from "./use-credit";

export function Order({ market, account, connected, ready, busy, stale, failed, onConnect, onOpen }: {
  market?: Market; account?: AccountView; connected: boolean; ready: boolean; busy: boolean; stale: boolean; failed: boolean;
  onConnect: () => void; onOpen: (options: OpenOptions) => Promise<void>;
}) {
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [text, setText] = useState("");
  const [slippage, setSlippage] = useState(50);
  const [opening, setOpening] = useState(false);
  const decimals = direction === "buy" ? 6 : 18, symbol = direction === "buy" ? "USDC" : "MON";
  const amount = amountUnits(text, decimals);
  const quote = market && amount ? estimate(market, direction, amount, slippage) : undefined;
  const aboveLimit = direction === "buy" && market && amount !== undefined && amount > (amountUnits(market.maximum_buy, 6) ?? 0n);
  const unavailable = !market || market.state !== 0 || stale;
  const problem = text && !amount ? `Enter a positive amount with up to ${decimals} decimals.`
    : aboveLimit ? `The testnet trade limit is ${market.maximum_buy} USDC.`
    : direction === "sell" && account && amount && amount > (amountUnits(account.mon, 18) ?? 0n) ? "Not enough MON in this Credit Account."
    : amount && market && !quote ? "Not enough displayed liquidity for this amount." : "";
  const open = async (options: OpenOptions) => { setOpening(true); try { await onOpen(options); } finally { setOpening(false); } };
  return <section className="kuru-order" aria-labelledby="trade-title">
    <div className="kuru-order-title"><h2 id="trade-title">Trade</h2><span>Market</span></div>
    <div className="kuru-directions" role="group" aria-label="Trade direction">
      {(["buy", "sell"] as const).map((side) => <button key={side} type="button" aria-pressed={direction === side} className={side} onClick={() => { setDirection(side); setText(""); }}>{side === "buy" ? "Buy MON" : "Sell MON"}</button>)}
    </div>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!connected) { onConnect(); return; }
      if (!ready || !market || !amount || problem || unavailable || opening) return;
      void open({ creditId: account?.id, action: { use_case: "spot", capability: "place_order", params: {
        market_id: market.market_id, direction, order_type: "market", amount: { spend: amount }, slippage_bps: slippage,
      } } });
    }}>
      <label htmlFor="trade-amount" className="kuru-field-label">{direction === "buy" ? "Spend" : "Sell"}</label>
      <div className="kuru-amount"><input id="trade-amount" value={text} onChange={(event) => setText(event.target.value)} placeholder="0.00" inputMode="decimal" autoComplete="off" aria-invalid={!!problem} aria-describedby={problem ? "trade-error" : undefined} /><span>{symbol}</span></div>
      <div className="kuru-available"><span>Account balance</span><span>{account ? `${number(direction === "buy" ? account.usdc : account.mon)} ${symbol}` : "—"}
        {direction === "sell" && account && <button type="button" onClick={() => setText(account.mon)}>Max</button>}</span></div>
      <div className="kuru-slippage"><label htmlFor="slippage">Slippage</label><select id="slippage" value={slippage} onChange={(event) => setSlippage(Number(event.target.value))}>
        <option value={50}>0.5%</option><option value={100}>1%</option>
      </select></div>
      <dl className="kuru-quote"><dt>Est. receive</dt><dd>{quote ? `${number(quote.output)} ${direction === "buy" ? "MON" : "USDC"}` : "—"}</dd>
        <dt>Est. minimum</dt><dd>{quote ? `${number(quote.minimum)} ${direction === "buy" ? "MON" : "USDC"}` : "—"}</dd>
        <dt>Trading fee</dt><dd>{market ? `${market.fee_bps / 100}%` : "—"}</dd></dl>
      {problem && <p id="trade-error" className="kuru-error" role="alert">{problem}</p>}
      <Button type="submit" className="w-full" disabled={busy || opening || connected && (!ready || !amount || !!problem || unavailable)}>
        {!connected ? "Connect wallet" : opening ? "Opening Termbook…" : failed ? "Trading unavailable" : !ready ? "Checking integration…" : direction === "buy" ? "Review buy" : "Review sell"}<ArrowUpRight size={15} />
      </Button>
    </form>
    <div className="kuru-order-credit"><Info size={15} aria-hidden="true" /><p>{direction === "buy" ? "Use your account funds. Termbook can draw approved credit for the shortfall." : "Sale proceeds return to your Credit Account. Repay or close in Termbook."}</p></div>
    <Button variant="secondary" className="w-full" disabled={!ready || opening} onClick={() => void open({ tab: "account", creditId: account?.id })}>{account ? "Manage credit" : "Set up credit"}</Button>
    {market && <p className="kuru-limit">Testnet · Up to {market.maximum_buy} USDC per buy</p>}
  </section>;
}
