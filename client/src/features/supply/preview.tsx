import { formatUnits, parseUnits } from "viem";
import { sharePrice } from "@/features/houses/state";
import type { House } from "@/features/houses/types";
import { schema, type SupplyValues } from "./schema";

export function quote(input: { asset: "USDC"; amount: string | number }, house: House) {
  const values = schema.parse(input);
  const received = parseUnits(values.amount, house.decimals);
  if (house.decimals !== 6 || BigInt(house.sharePrice) <= 0n)
    throw new Error("House quote unavailable.");
  const shares =
    house.totalShares === "0" ? received : (received * 10n ** 18n) / BigInt(house.sharePrice);
  if (shares === 0n) throw new Error("Amount is too small for this House.");
  return { received: String(received), shares, minimum: (shares * 9950n) / 10000n };
}

export function Preview({ values, house }: { values: SupplyValues; house: House }) {
  const result = quote(values, house);
  return (
    <dl className="supply-result">
      <dt>You supply</dt>
      <dd>
        {values.amount} {values.asset}
      </dd>
      <dt>Est. shares</dt>
      <dd>{formatUnits(result.shares, house.decimals)}</dd>
      <dt>Min. shares</dt>
      <dd>{formatUnits(result.minimum, house.decimals)}</dd>
      <dt>Share price</dt>
      <dd>{sharePrice(house)} USDC</dd>
    </dl>
  );
}
