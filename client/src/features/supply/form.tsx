"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { House } from "@/features/houses/types";
import { canSupply } from "@/features/houses/state";
import { Preview, quote } from "./preview";
import { schema, type SupplyValues } from "./schema";

export function Form({ house, onClose }: { house: House; onClose: () => void }) {
  const [asset, setAsset] = useState<"USDC" | "WETH">("USDC");
  const [amount, setAmount] = useState("500");
  const [preview, setPreview] = useState<SupplyValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = schema.safeParse({ asset, amount });
    setPreview(null);
    if (!values.success || !canSupply(house)) {
      setError("Enter a valid amount.");
      return;
    }
    try {
      quote(values.data, house);
      setPreview(values.data);
      setError(null);
    } catch {
      setError("Enter a valid amount.");
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="field-label">
        Pay with
        <Select
          aria-label="Funding asset"
          value={asset}
          onChange={(event) => {
            const asset = event.target.value === "WETH" ? "WETH" : "USDC";
            setAsset(asset);
            setAmount(asset === "WETH" ? "0.2" : "500");
            setPreview(null);
            setError(null);
          }}
        >
          <option value="USDC">USDC · Monad testnet</option>
          <option value="WETH">WETH · Sepolia</option>
        </Select>
      </label>
      <label className="field-label">
        Amount
        <Input
          aria-label="Supply amount"
          type="number"
          inputMode="decimal"
          min="0.000001"
          step="any"
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setPreview(null);
            setError(null);
          }}
        />
      </label>
      <div className="mt-[18px] flex gap-[10px]">
        <Button variant="supply" type="submit">
          Preview supply
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div aria-live="polite">{preview && <Preview values={preview} house={house} />}</div>
    </form>
  );
}
