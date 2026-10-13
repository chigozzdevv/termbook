import { money } from "@/lib/format";
import type { House } from "./types";
import type { Order } from "@/features/orders/types";

export function houseStats(houses: House[]) {
  const assets = new Map<string, { asset: string; symbol: string; decimals: number; total: bigint; available: bigint; reserved: bigint; principal: bigint }>();
  for (const house of houses) {
    const key = `${house.asset.toLowerCase()}:${house.decimals}`;
    const asset = assets.get(key) ?? { asset: house.asset, symbol: house.assetSymbol, decimals: house.decimals,
      total: 0n, available: 0n, reserved: 0n, principal: 0n };
    asset.total += BigInt(house.totalAssets);
    asset.principal += BigInt(house.drawnPrincipal);
    asset.reserved += BigInt(house.committedCash);
    if (house.active && !house.paused) asset.available += BigInt(house.availableCash);
    assets.set(key, asset);
  }
  return [...assets.values()];
}

export function Stats({ houses, orders, loading, unavailable, creditsUnavailable }: {
  houses: House[]; orders: Order[]; loading: boolean; unavailable: boolean; creditsUnavailable: boolean;
}) {
  const totals = houseStats(houses);
  const credits = orders.filter((order) => order.kind === "credit").length;
  const unknown = loading || unavailable;
  return <dl aria-label="House statistics" aria-busy={loading}
    className="mb-7 grid grid-cols-5 gap-px overflow-hidden rounded-2xl border border-line bg-line max-[760px]:grid-cols-2">
    {([["Total", "total"], ["Available", "available"], ["Reserved", "reserved"], ["Borrowed", "principal"]] as const).map(([label, field]) =>
      <div key={field} className={`bg-panel px-5 py-5 max-[430px]:px-4 max-[430px]:py-4${field === "total" ? " max-[760px]:col-span-2" : ""}`}>
        <dt className="mb-3 text-xs text-muted max-[760px]:min-h-8">{label}</dt>
        <dd className="grid gap-2 font-mono text-[26px] leading-tight tracking-tight max-[760px]:text-[22px] max-[380px]:text-xl">
          {unknown ? "—" : totals.length ? totals.map((asset) => <span key={`${asset.asset}:${asset.decimals}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 max-[760px]:flex-col max-[760px]:items-start">
            <span>{money(String(asset[field]), asset.decimals)}</span>
            <span className="font-sans text-[11px] tracking-normal text-muted">{asset.symbol}</span>
          </span>) : "—"}
        </dd>
      </div>)}
    <div className="bg-panel px-5 py-5 max-[430px]:px-4 max-[430px]:py-4">
      <dt className="mb-3 text-xs text-muted max-[760px]:min-h-8">Credits</dt>
      <dd className="font-mono text-[26px] leading-tight tracking-tight max-[760px]:text-[22px] max-[380px]:text-xl">{creditsUnavailable ? "—" : credits}</dd>
    </div>
  </dl>;
}
