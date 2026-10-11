"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Wallet, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useMarket } from "./use-market";
import { useWallet } from "./wallet";
import { useCredit } from "./use-credit";
import { Chart } from "./chart";
import { Book } from "./book";
import { Order } from "./order";
import { Account } from "./account";
import { explorer, number, short } from "./data";

export function KuruPage() {
  const data = useMarket();
  const wallet = useWallet(data.market);
  const credit = useCredit(wallet.client);
  const [walletOpen, setWalletOpen] = useState(false);
  const [uiError, setUiError] = useState("");
  const [view, setView] = useState<"chart" | "book">("chart");
  const bid = data.market?.bids[0], ask = data.market?.asks[0];
  const last = data.trades.at(-1);
  const open: typeof wallet.open = async (options) => {
    setUiError("");
    try { await wallet.open(options); }
    catch { setUiError("Termbook could not open. Refresh and try again."); }
  };
  const stale = !!data.error || !data.market;
  return <>
    <header className="kuru-topbar gutter">
      <div className="kuru-brand"><Logo /><div className="kuru-identity"><Image src="/apps/kuru.svg" alt="" width={20} height={36} className="h-auto w-4" /><span>Kuru</span></div></div>
      <div className="kuru-wallet"><span className="kuru-network"><i />Monad testnet</span>
        {wallet.connection ? <><Button variant="secondary" onClick={() => wallet.client ? void open({ tab: "account", creditId: credit.account?.id }) : wallet.refresh()} disabled={wallet.busy}><Wallet size={14} />{short(wallet.connection.address)}</Button><button type="button" className="kuru-disconnect" aria-label="Disconnect wallet" onClick={wallet.disconnect}><X size={14} /></button></>
          : <Button onClick={() => setWalletOpen(true)} disabled={wallet.busy}><Wallet size={14} />{wallet.busy ? "Connecting…" : "Connect wallet"}</Button>}
      </div>
    </header>
    <main className="kuru-page">
    <div className="kuru-market-header"><div><h1>MON<span>/</span>USDC</h1><a href={data.market ? `${explorer}/address/${data.market.address}` : "/docs/integrations/kuru"} target={data.market ? "_blank" : undefined} rel="noopener noreferrer">Spot market<ArrowUpRight size={12} /></a></div>
      <dl><div><dt>Last trade</dt><dd>{last ? `${number(last.price)} USDC` : "—"}</dd></div><div><dt>Best bid</dt><dd className="buy">{bid ? number(bid.price) : "—"}</dd></div><div><dt>Best ask</dt><dd className="sell">{ask ? number(ask.price) : "—"}</dd></div></dl>
      <Link href="/apps" className="kuru-close" aria-label="Close Kuru" title="Close Kuru"><X size={18} /></Link>
    </div>
    {(data.error || wallet.error || uiError) && <div className="kuru-notice" role="status"><p>{uiError || wallet.error || data.error}</p><button type="button" onClick={() => { data.refresh(); wallet.refresh(); credit.refresh(); }}>Retry</button></div>}
    {wallet.connection && wallet.connection.chain !== 10143 && <div className="kuru-notice" role="status"><p>Switch your wallet to Monad testnet to continue.</p><button type="button" onClick={() => setWalletOpen(true)}>Switch network</button></div>}
    {data.market && data.market.state !== 0 && <div className="kuru-notice" role="status"><p>This market is temporarily paused.</p></div>}
    <div className="kuru-trading-grid"><div className="kuru-market" data-view={view}>
      <div className="kuru-view-toggle" role="group" aria-label="Market view">{(["chart", "book"] as const).map((value) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{value === "chart" ? "Chart" : "Order book"}</button>)}</div>
      <Chart trades={data.trades} error={data.historyError} /><Book market={data.market} /></div>
      <Order market={data.market} account={credit.account} connected={!!wallet.connection} ready={!!wallet.client} busy={wallet.busy} stale={stale} failed={!!wallet.error} onConnect={() => setWalletOpen(true)} onOpen={open} />
      <Account rows={credit.rows} account={credit.account} trades={data.trades} connected={!!wallet.connection} ready={!!wallet.client} error={credit.error} onSelect={credit.select} onOpen={open} onRefresh={() => { data.refresh(); credit.refresh(); }} />
    </div>
    <Dialog id="kuru-wallet" open={walletOpen} onClose={() => setWalletOpen(false)} title="Connect wallet">
      <p className="mb-5 text-sm text-muted">Connect your Monad wallet. Termbook connects the collateral wallet when you set up credit.</p>
      <div className="grid gap-3">{wallet.wallets.length ? wallet.wallets.map((row) => <Button variant="secondary" key={row.info.uuid} disabled={wallet.busy} onClick={() => { setWalletOpen(false); void wallet.connect(row); }}>{row.info.name}<ArrowUpRight size={14} /></Button>)
        : <p className="text-sm text-muted">No browser wallet found. Open this page in a browser with an EVM wallet installed.</p>}</div>
      {wallet.error && <p className="kuru-error" role="alert">{wallet.error}</p>}
    </Dialog>
    </main>
  </>;
}
