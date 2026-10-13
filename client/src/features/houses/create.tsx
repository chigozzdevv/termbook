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
import { Dialog } from "@/components/ui/dialog";
import { short } from "@/lib/format";
import { schema as amountSchema } from "@/features/supply/schema";
import { useWallet } from "@/features/wallet/use-wallet";
import type { Connection } from "@/features/wallet/connection";

type Setup = { chain_id: number; asset: string; manager: string; initial_liquidity: string };

export function Create() {
  const wallet = useWallet();
  const [walletOpen, setWalletOpen] = useState(false);
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
      <header className="mb-6 flex items-start gap-3">
        <Link
          href="/houses"
          aria-label="Back to Houses"
          title="Back to Houses"
          className="touch-target grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" size={20} />
        </Link>
        <div className="min-w-0">
          <h1 className="mt-1 mb-2 font-heading text-[32px] leading-[1.1] max-[430px]:text-[28px]">
            Create House
          </h1>
          <p className="text-[13px] leading-[1.6] text-muted">
            Prepare your House. Deployment and activation follow review.
          </p>
        </div>
      </header>
      <section className="rounded-2xl border border-line bg-panel p-6 max-[430px]:p-4">
        {!setup ? (
          <form onSubmit={review} noValidate>
            <label className="field-label">
              Lending asset
              <Select aria-label="Lending asset" defaultValue="USDC">
                <option value="USDC">USDC · Monad testnet</option>
              </Select>
            </label>
            <div className="mb-5">
              <div
                role="group"
                aria-labelledby="manager-wallet-label"
                className="flex min-h-11 items-center justify-between gap-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Wallet
                    aria-hidden="true"
                    size={18}
                    className="shrink-0 text-muted max-[350px]:hidden"
                  />
                  <div className="min-w-0">
                    <p
                      id="manager-wallet-label"
                      className="text-[13px] whitespace-nowrap text-[#d7dcde]"
                    >
                      Manager wallet
                    </p>
                    {wallet.connection && (
                      <span
                        title={wallet.connection.address}
                        className="mt-1 block truncate font-mono text-xs text-muted"
                      >
                        {short(wallet.connection.address)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant={wallet.connection ? "secondary" : "primary"}
                    className="min-h-10 px-[10px] text-xs"
                    aria-label={
                      wallet.busy
                        ? "Connecting wallet"
                        : wallet.connection
                          ? `Change manager wallet ${wallet.connection.address}`
                          : "Connect wallet"
                    }
                    title={wallet.connection?.address}
                    aria-describedby="manager-wallet-label"
                    onClick={() => {
                      setError("");
                      setWalletOpen(true);
                    }}
                    disabled={wallet.busy}
                  >
                    {wallet.busy ? "Connecting…" : wallet.connection ? "Change" : "Connect wallet"}
                  </Button>
                  {wallet.connection && (
                    <button
                      type="button"
                      aria-label="Disconnect manager wallet"
                      title="Disconnect wallet"
                      onClick={wallet.disconnect}
                      className="touch-target grid size-11 shrink-0 place-items-center rounded-lg border border-line text-muted hover:text-foreground"
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                  )}
                </div>
              </div>
              {wallet.connection && !manager && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  Switch to Monad testnet.{" "}
                  <button type="button" className="underline" onClick={() => setWalletOpen(true)}>
                    Connect again
                  </button>
                </p>
              )}
            </div>
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
              A House becomes active after deployment, governance registration, policy configuration
              and funding.
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
      <Dialog
        id="house-wallet"
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        title="Connect wallet"
      >
        <div className="mt-5 grid gap-3">
          {wallet.wallets.length ? (
            wallet.wallets.map((row) => (
              <Button
                variant="secondary"
                key={row.info.uuid}
                disabled={wallet.busy}
                onClick={async () => {
                  if (await wallet.connect(row)) setWalletOpen(false);
                }}
              >
                {row.info.name}
              </Button>
            ))
          ) : (
            <p className="text-sm leading-[1.6] text-muted">
              No browser wallet found. Open this page in a browser with an EVM wallet installed.
            </p>
          )}
        </div>
        {wallet.error && (
          <p role="alert" className="mt-4 text-xs text-danger">
            {wallet.error}
          </p>
        )}
      </Dialog>
    </main>
  );
}
