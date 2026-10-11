import { money, number } from "@/lib/format";
import { sharePrice } from "@/features/houses/state";
import type { House } from "@/features/houses/types";
import type { SupplyValues } from "./schema";

export function quote(values: SupplyValues, house: House) {
  const received = Math.floor(values.amount * (values.asset === "WETH" ? 2500 : 1) * 1e6);
  if (!Number.isSafeInteger(received) || received <= 0) throw new Error("Enter a valid amount.");
  const shares = (BigInt(received) * 10n ** 18n) / BigInt(house.sharePrice);
  return { received: String(received), shares, minimum: (shares * 9950n) / 10000n };
}

export function Preview({ values, house }: { values: SupplyValues; house: House }) {
  const result = quote(values, house);
  return (
    <dl className="supply-result">
      <dt>You pay</dt>
      <dd>
        {number(values.amount)} {values.asset}
      </dd>
      <dt>House receives</dt>
      <dd>{money(result.received)} USDC</dd>
      <dt>Est. shares</dt>
      <dd>{number(Number(result.shares) / 1e6)}</dd>
      <dt>Minimum shares</dt>
      <dd>{number(Number(result.minimum) / 1e6)}</dd>
      <dt>Share price</dt>
      <dd>{sharePrice(house)} USDC</dd>
      {values.asset === "WETH" && (
        <>
          <dt>Mock quote</dt>
          <dd>2,500 USDC / WETH</dd>
        </>
      )}
    </dl>
  );
}
