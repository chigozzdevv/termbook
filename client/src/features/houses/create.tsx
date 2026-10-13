"use client";

import Link from "next/link";
import { ArrowLeft, Wallet, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { parseUnits } from "viem";
import deployment from "../../../../deployments/testnet.json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CopyButton } from "@/components/ui/copy-button";
import { Picker } from "@/features/wallet/picker";
import { short } from "@/lib/format";
import { schema as amountSchema } from "@/features/supply/schema";
import { useWallet } from "@/features/wallet/use-wallet";
import type { Connection } from "@/features/wallet/connection";

type Setup = { chain_id: number; asset: string; manager: string; initial_liquidity: string };

export function Create() {
  const wallet = useWallet();
  const [walletOpen, setWalletOpen] = useState(() => wallet.connection?.chain !== 10143);
  const [amount, setAmount] = useState("");
  const [reviewed, setReviewed] = useState<{ setup: Setup; connection: Connection } | null>(null);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const manager =
    !wallet.busy && wallet.connection?.chain === 10143 ? wallet.connection : undefined;
  const setup = manager && reviewed?.connection === manager ? reviewed.setup : null;

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!manager) {
      setError("Connect your manager wallet on Monad testnet.");
      return;
    }
    const values = amountSchema.safeParse({ asset: "USDC", amount });
    if (!values.success) {
      setError(values.error.issues[0].message);
      return;
    }
    setDownloaded(false);
    setReviewed({
      connection: manager,
      setup: {
        chain_id: 10143,
        asset: deployment.tokens["10143"].USDC,
        manager: manager.address,
        initial_liquidity: parseUnits(values.data.amount, 6).toString(),
      },
    });
  }

  function download() {
    if (!setup) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(setup, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "house-setup.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
  }

  return (
    <main className="gutter mx-auto max-w-[640px] py-9 max-[430px]:py-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/houses"
              aria-label="Back to Houses"
              title="Back to Houses"
              className="touch-target grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" size={20} />
            </Link>
            <h1 className="font-heading text-[32px] leading-[1.1] max-[430px]:text-[28px]">
              Create House
            </h1>
          </div>
          {wallet.connection && (
            <div
              role="group"
              aria-label="Connected manager wallet"
              className="flex min-w-0 items-center gap-2 max-[430px]:ml-[52px]"
            >
              <span
                title={wallet.connection.address}
                className="inline-flex items-center gap-1 font-mono text-xs text-muted"
              >
                <Wallet aria-hidden="true" size={14} />
                {short(wallet.connection.address)}
              </span>
              <Button
                variant="secondary"
                className="min-h-9 px-2 py-1 text-xs"
                onClick={() => setWalletOpen(true)}
                disabled={wallet.busy}
                aria-label="Change manager wallet"
              >
                Change
              </Button>
              <button
                type="button"
                onClick={() => {
                  wallet.disconnect();
                  setWalletOpen(true);
                }}
                aria-label="Disconnect manager wallet"
                title="Disconnect wallet"
                className="touch-target grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:text-foreground"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
          )}
        </div>
        <p className="mt-2 ml-[52px] text-[13px] leading-[1.6] text-muted">
          Prepare your House. Deployment and activation follow review.
        </p>
      </header>
      {manager ? (
        <section className="rounded-2xl border border-line bg-panel p-6 max-[430px]:p-4">
          {!setup ? (
            <form onSubmit={review} noValidate>
              <label className="field-label">
                Lending asset
                <Select aria-label="Lending asset" defaultValue="USDC">
                  <option value="USDC">USDC · Monad testnet</option>
                </Select>
              </label>
              <label className="field-label">
                Initial liquidity
                <Input
                  aria-label="Initial liquidity"
                  placeholder="0.00 USDC"
                  inputMode="decimal"
                  maxLength={25}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              {(error || wallet.error) && (
                <p role="alert" className="mb-4 text-xs text-danger">
                  {error || wallet.error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={!manager}>
                Review setup
              </Button>
            </form>
          ) : (
            <>
              <h2 className="mb-5 text-sm font-medium">Review House</h2>
              <dl className="supply-summary">
                <dt>Network</dt>
                <dd>Monad testnet</dd>
                <dt>Lending asset</dt>
                <dd>USDC</dd>
                <dt>Manager</dt>
                <dd className="inline-flex items-center justify-end gap-1">
                  <span title={setup.manager}>{short(setup.manager)}</span>
                  <CopyButton value={setup.manager} label="manager wallet" />
                </dd>
                <dt>Initial liquidity</dt>
                <dd>{amount} USDC</dd>
              </dl>
              <p className="mt-6 text-xs leading-[1.6] text-muted">
                A House becomes active after deployment, governance registration, policy
                configuration and funding.
              </p>
              <Button className="mt-5 w-full" onClick={download}>
                Download setup
              </Button>
              <Button variant="secondary" className="mt-2 w-full" onClick={() => setReviewed(null)}>
                Edit setup
              </Button>
              {downloaded && (
                <p role="status" className="mt-4 text-xs text-success">
                  Setup downloaded. No House has been deployed.
                </p>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-line bg-panel p-6 text-center max-[430px]:p-4">
          <p className="text-sm text-muted">
            {wallet.busy
              ? wallet.phase === "adding"
                ? "Adding Monad testnet…"
                : wallet.phase === "switching"
                  ? "Switching to Monad testnet…"
                  : "Connecting your wallet…"
              : wallet.connection && wallet.connection.chain !== 10143
                ? "Switch to Monad testnet to continue."
                : "Connect your Monad wallet to continue."}
          </p>
          <Button className="mt-5" onClick={() => setWalletOpen(true)} disabled={wallet.busy}>
            {wallet.busy
              ? wallet.phase === "adding"
                ? "Adding…"
                : wallet.phase === "switching"
                  ? "Switching…"
                  : "Connecting…"
              : wallet.connection
                ? "Switch network"
                : "Connect wallet"}
          </Button>
          {wallet.error && (
            <p role="alert" className="mt-4 text-xs text-danger">
              {wallet.error}
            </p>
          )}
        </section>
      )}
      <Picker id="house-wallet" open={walletOpen} onClose={() => setWalletOpen(false)} />
    </main>
  );
}
