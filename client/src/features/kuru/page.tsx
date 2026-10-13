"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Wallet, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Network } from "@/components/layout/network";
import { Picker } from "@/features/wallet/picker";
import { Account as WalletAccount } from "@/features/wallet/account";
import { useMarket } from "./use-market";
import { useWallet } from "./wallet";
import { useCredit } from "./use-credit";
import { Chart } from "./chart";
import { Book } from "./book";
import { Order } from "./order";
import { Account } from "./account";
import { explorer, number } from "./data";

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
    <header className="kuru-topbar site-header gutter">
      <div className="kuru-brand"><Logo mobileMark /><div className="kuru-identity"><Image src="/apps/kuru.svg" alt="" width={20} height={36} className="h-auto w-4" /><span>Kuru</span></div></div>
      <Network />
      <div className="kuru-wallet">
        {wallet.connection ? <WalletAccount address={wallet.connection.address} addressClassName="kuru-wallet-address" disabled={wallet.busy} onDisconnect={wallet.disconnect} onAccount={wallet.client ? () => void open({ tab: "account", creditId: credit.account?.id }) : undefined} />
          : <Button aria-label={wallet.busy ? "Connecting wallet" : "Connect wallet"} onClick={() => setWalletOpen(true)} disabled={wallet.busy}><Wallet size={14} />{wallet.busy ? "Connecting…" : <>Connect<span className="kuru-wallet-word">wallet</span></>}</Button>}
      </div>
    </header>
    <main className="kuru-page">
    <div className="kuru-market-header"><div><h1>MON<span>/</span>USDC</h1><a href={data.market ? `${explorer}/address/${data.market.address}` : "/docs/integrations/kuru"} target={data.market ? "_blank" : undefined} rel="noopener noreferrer">Spot market<ArrowUpRight size={12} /></a></div>
      <dl><div><dt>Last trade</dt><dd>{last ? `${number(last.price)} USDC` : "—"}</dd></div><div><dt>Best bid</dt><dd className="buy">{bid ? number(bid.price) : "—"}</dd></div><div><dt>Best ask</dt><dd className="sell">{ask ? number(ask.price) : "—"}</dd></div></dl>
      <Link href="/apps" className="kuru-close" aria-label="Close Kuru" title="Close Kuru"><X size={18} /></Link>
    </div>
    {(data.error || wallet.error || uiError) && <div className="kuru-notice" role="status"><p>{uiError || wallet.error || data.error}</p><button type="button" onClick={() => { data.refresh(); wallet.refresh(); credit.refresh(); }}>Retry</button></div>}
    {wallet.connection && wallet.connection.chain !== 10143 && <div className="kuru-notice" role="status"><p>Switch your wallet to Monad testnet to continue.</p><button type="button" disabled={wallet.busy} onClick={async () => { if (!await wallet.switchNetwork()) setWalletOpen(true); }}>Switch network</button></div>}
    {data.market && data.market.state !== 0 && <div className="kuru-notice" role="status"><p>This market is temporarily paused.</p></div>}
    <div className="kuru-trading-grid"><div className="kuru-market" data-view={view}>
      <div className="kuru-view-toggle" role="group" aria-label="Market view">{(["chart", "book"] as const).map((value) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{value === "chart" ? "Chart" : "Order book"}</button>)}</div>
      <Chart /><Book market={data.market} /></div>
      <Order market={data.market} account={credit.account} connected={!!wallet.connection} ready={!!wallet.client} busy={wallet.busy} stale={stale} failed={!!wallet.error} onConnect={() => setWalletOpen(true)} onOpen={open} />
      <Account rows={credit.rows} account={credit.account} trades={data.trades} connected={!!wallet.connection} ready={!!wallet.client} error={credit.error} onSelect={credit.select} onOpen={open} onRefresh={() => { data.refresh(); credit.refresh(); }} />
    </div>
    <Picker id="kuru-wallet" open={walletOpen} onClose={() => setWalletOpen(false)} />
    </main>
  </>;
}
