"use client";

import { useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { formatUnits } from "viem";
import type { OpenOptions } from "@termbook/sdk";
import type { AccountView } from "./use-credit";
import { explorer, number, short, type Trade } from "./data";

export function Account({ rows, account, trades, connected, ready, error, onSelect, onOpen, onRefresh }: {
  rows: AccountView[]; account?: AccountView; trades: Trade[]; connected: boolean; ready: boolean; error: string;
  onSelect: (id: string) => void; onOpen: (options: OpenOptions) => Promise<void>; onRefresh: () => void;
}) {
  const [tab, setTab] = useState<"holdings" | "trades">("holdings");
  return <section className="kuru-account" aria-label="Trading account">
    <header><div role="tablist" aria-label="Account view" onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "holdings" : event.key === "End" ? "trades" : tab === "holdings" ? "trades" : "holdings";
      setTab(next); document.getElementById(`${next}-tab`)?.focus();
    }}><button role="tab" tabIndex={tab === "holdings" ? 0 : -1} aria-selected={tab === "holdings"} aria-controls="holdings-panel" id="holdings-tab" onClick={() => setTab("holdings")}>Credit Account</button><button role="tab" tabIndex={tab === "trades" ? 0 : -1} aria-selected={tab === "trades"} aria-controls="trades-panel" id="trades-tab" onClick={() => setTab("trades")}>Market trades</button></div>
      <button type="button" className="kuru-refresh" onClick={onRefresh} aria-label="Refresh account and market"><RefreshCw size={14} /></button>
    </header>
    {tab === "holdings" ? <div role="tabpanel" id="holdings-panel" aria-labelledby="holdings-tab">
      {account ? <>
        <div className="kuru-account-meta"><label htmlFor="credit-select">Credit</label><select id="credit-select" value={account.id} onChange={(event) => onSelect(event.target.value)}>{rows.map((row) => <option key={row.id} value={row.id}>{short(row.id)} · {row.facility.replaceAll("_", " ")}</option>)}</select>
          {account.account && <a href={`${explorer}/address/${account.account}`} target="_blank" rel="noopener noreferrer">{short(account.account)}<ArrowUpRight size={13} /></a>}
          <button type="button" disabled={!ready} onClick={() => void onOpen({ tab: "account", creditId: account.id })}>Manage credit<ArrowUpRight size={13} /></button>
        </div>
        <dl className="kuru-account-summary"><div><dt>Debt</dt><dd>{number(formatUnits(account.debt, 6))} USDC</dd></div><div><dt>Credit limit</dt><dd>{number(formatUnits(account.limit, 6))} USDC</dd></div><div><dt>Recovery health</dt><dd>{account.health === null ? "—" : `${account.health}%`}</dd></div><div><dt>Status</dt><dd className="capitalize">{account.facility.replaceAll("_", " ")}</dd></div></dl>
        <table className="kuru-table"><thead><tr><th>Asset</th><th>Account balance</th><th>Held at</th></tr></thead><tbody>
          <tr><td>MON</td><td>{number(account.mon, 8)}</td><td>Credit Account</td></tr><tr><td>USDC</td><td>{number(account.usdc)}</td><td>Credit Account</td></tr>
        </tbody></table>
      </> : <div className="kuru-account-empty"><p>{connected ? "Set up a Credit Account to trade with Termbook." : "Connect your wallet to view your Credit Account."}</p>{ready && <button type="button" onClick={() => void onOpen({ tab: "account" })}>Set up credit<ArrowUpRight size={14} /></button>}</div>}
      {error && <p className="kuru-error" role="status">{error}</p>}
    </div> : <div role="tabpanel" id="trades-panel" aria-labelledby="trades-tab" className="kuru-trades-panel">
      {trades.length ? <table className="kuru-table"><thead><tr><th>Price (USDC)</th><th>Size (MON)</th><th>Side</th><th>Time (UTC)</th><th>Transaction</th></tr></thead><tbody>
        {trades.slice(-30).reverse().map((trade) => <tr key={trade.id}><td className={trade.direction}>{number(trade.price)}</td><td>{number(trade.size, 8)}</td><td className="capitalize">{trade.direction}</td><td>{new Date(trade.time * 1000).toISOString().slice(11, 19)}</td><td><a href={`${explorer}/tx/${trade.tx}`} target="_blank" rel="noopener noreferrer">{short(trade.tx)}<ArrowUpRight size={13} /></a></td></tr>)}
      </tbody></table> : <p className="kuru-empty">No recent market trades.</p>}
    </div>}
  </section>;
}
