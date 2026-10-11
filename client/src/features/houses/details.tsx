import { Fact } from "@/components/table/facts";
import { Identifier } from "@/components/table/identifier";
import { money, statusLabel } from "@/lib/format";
import type { Order } from "@/features/orders/types";
import { depositState, sharePrice } from "./state";
import type { House } from "./types";

export function Details({
  house,
  orders,
  onOrder,
}: {
  house: House;
  orders: Order[];
  onOrder: (id: string) => void;
}) {
  return (
    <>
      <dl className="facts">
        <Fact label="Lend asset">USDC</Fact>
        <Fact label="Status">{house.paused ? "Paused" : "Active"}</Fact>
        <Fact label="Deposits">{depositState(house)}</Fact>
        <Fact label="Total assets">{money(house.totalAssets)} USDC</Fact>
        <Fact label="Liquidity">{money(house.availableCash)} USDC</Fact>
        <Fact label="Reserved">{money(house.committedCash)} USDC</Fact>
        <Fact label="Deployed principal">{money(house.drawnPrincipal)} USDC</Fact>
        <Fact label="Share price">{sharePrice(house)} USDC</Fact>
        <Fact label="Queued withdrawals">{money(house.queuedWithdrawalAssets)} USDC</Fact>
        <Fact label="Total shares">{money(house.totalShares)}</Fact>
        <Fact label="House" wide>
          {house.house}
        </Fact>
        <Fact label="Vault" wide>
          {house.vault}
        </Fact>
        <Fact label="Manager" wide>
          {house.manager}
        </Fact>
      </dl>
      <h3 className="mb-3 text-[13px] font-medium">Credit records</h3>
      <div className="grid gap-3">
        {orders
          .filter((order) => order.house === house.house)
          .map((order) => (
            <div key={order.id} className="transaction">
              <Identifier value={order.id} label="order" onClick={() => onOrder(order.id)} />
              <span>{statusLabel(order.status)}</span>
              <span className="number">{money(order.limit)} USDC</span>
            </div>
          ))}
      </div>
    </>
  );
}
