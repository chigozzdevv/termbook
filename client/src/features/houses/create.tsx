"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { getAddress, isAddress, parseUnits } from "viem";
import deployment from "../../../../deployments/testnet.json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CopyButton } from "@/components/ui/copy-button";
import { short } from "@/lib/format";
import { schema as amountSchema } from "@/features/supply/schema";

type Setup = { chain_id: number; asset: string; manager: string; initial_liquidity: string };

export function Create() {
  const [manager, setManager] = useState("");
  const [amount, setAmount] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const managerAddress = manager.trim();
    if (!isAddress(managerAddress) || /^0x0{40}$/i.test(managerAddress)) {
      setError("Enter a valid manager wallet address.");
      return;
    }
    const values = amountSchema.safeParse({ asset: "USDC", amount });
    if (!values.success) {
      setError(values.error.issues[0].message);
      return;
    }
    setDownloaded(false);
    setSetup({
      chain_id: 10143,
      asset: deployment.tokens["10143"].USDC,
      manager: getAddress(managerAddress),
      initial_liquidity: parseUnits(values.data.amount, 6).toString(),
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
            <p className="-mt-2 mb-5 text-xs text-muted">
              The lending asset is fixed for this House.
            </p>
            <label className="field-label">
              Manager wallet
              <Input
                aria-label="Manager wallet"
                placeholder="0x…"
                autoComplete="off"
                value={manager}
                onChange={(event) => setManager(event.target.value)}
              />
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
            {error && (
              <p role="alert" className="mb-4 text-xs text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full">
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
            <Button variant="secondary" className="mt-2 w-full" onClick={() => setSetup(null)}>
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
    </main>
  );
}
