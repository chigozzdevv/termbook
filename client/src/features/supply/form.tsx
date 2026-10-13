"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { formatUnits } from "viem";
import { money } from "@/lib/format";
import type { House } from "@/features/houses/types";
import { canSupply, sharePrice } from "@/features/houses/state";
import { Preview, quote } from "./preview";
import { schema, type SupplyValues } from "./schema";

export function Form({ house, onClose }: { house: House; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<SupplyValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  let estimate: ReturnType<typeof quote> | null = null;
  try {
    estimate = quote({ asset: "USDC", amount }, house);
  } catch {
    /* Incomplete amounts have no quote. */
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = schema.safeParse({ asset: "USDC", amount });
    setPreview(null);
    if (!canSupply(house)) {
      setError("This House is not accepting deposits.");
      return;
    }
    if (!values.success) {
      setError(values.error.issues[0].message);
      return;
    }
    try {
      quote(values.data, house);
      setPreview(values.data);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Supply estimate unavailable.");
    }
  }

  if (preview)
    return (
      <div>
        <h3 className="text-sm font-medium">Supply estimate</h3>
        <Preview values={preview} house={house} />
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setPreview(null)}>
            Back
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
        <p className="mt-3 text-center text-xs leading-[1.5] text-muted">
          No deposit is submitted.
        </p>
      </div>
    );

  return (
    <form onSubmit={submit} noValidate>
      <div className="supply-amount">
        <div className="mb-3 flex items-center justify-between gap-3">
          <label htmlFor="supply-amount" className="block text-xs text-muted">
            You supply
          </label>
          <span className="inline-flex shrink-0 items-center gap-2 text-sm">
            <span
              className="grid size-6 place-items-center rounded-full bg-[#205087] text-white"
              aria-hidden="true"
            >
              $
            </span>
            USDC
          </span>
        </div>
        <input
          id="supply-amount"
          aria-label="Supply amount"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          autoComplete="off"
          maxLength={25}
          autoFocus
          className="block w-full min-w-0 bg-transparent font-mono text-[32px] leading-[1.2] outline-none placeholder:text-[#53595d]"
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setPreview(null);
            setError(null);
          }}
        />
        <span className="mt-3 block text-xs text-muted">Monad testnet</span>
      </div>
      <dl className="supply-summary">
        <dt>House liquidity</dt>
        <dd>{money(house.availableCash)} USDC</dd>
        <dt>Share price</dt>
        <dd>{sharePrice(house)} USDC</dd>
        <dt>Estimated shares</dt>
        <dd>{estimate ? formatUnits(estimate.shares, house.decimals) : "—"}</dd>
      </dl>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-6 w-full">
        Review supply
      </Button>
      <p className="mt-3 text-center text-xs leading-[1.5] text-muted">
        Estimate only. No deposit is submitted.
      </p>
    </form>
  );
}
