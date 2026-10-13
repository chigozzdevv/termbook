import { Identifier } from "@/components/table/identifier";
import { Status } from "@/components/table/status";
import { Sort, type SortState } from "@/components/table/sort";
import { explorer } from "@/lib/explorers";
import { money, relativeTime } from "@/lib/format";
import { apr, collateral, term } from "./format";
import type { Order } from "./types";

interface Props {
  orders: Order[];
  sort: SortState;
  onSort: (key: string) => void;
  onHouse: (address: string) => void;
  empty?: string;
}

export function Table({ orders, sort, onSort, onHouse, empty }: Props) {
  return (
    <table className="data-table orders-table" aria-label="Borrowing requests and credits">
      <thead>
        <tr>
          <Sort label="Order" name="id" sort={sort} onSort={onSort} />
          <th>Chain</th>
          <th>Collateral</th>
          <th>Status</th>
          <Sort label="Limit" name="limit" sort={sort} onSort={onSort} />
          <Sort label="Debt" name="debt" sort={sort} onSort={onSort} />
          <Sort label="APR" name="aprBps" sort={sort} onSort={onSort} />
          <Sort label="Term" name="duration" sort={sort} onSort={onSort} />
          <th>Borrower</th>
          <th>House</th>
          <Sort label="Created" name="createdAt" sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id}>
            <td>
              <Identifier value={order.id} label="order" square href={`/orders/${order.id}`} />
            </td>
            <td>
              <span className="inline-flex rounded-2xl border border-[#414547] bg-[#1c1e1f] px-[6px] py-[2px] font-mono text-xs leading-[1.15] text-[#a6adb2]">
                {order.collateral.chain.label}
              </span>
            </td>
            <td className="number">{collateral(order)}</td>
            <td>
              <Status value={order.status} />
            </td>
            <td className="number">{money(order.limit, order.settlementDecimals)} {order.settlementSymbol}</td>
            <td className="number">{order.debt === null ? "—" : `${money(order.debt, order.settlementDecimals)} ${order.settlementSymbol}`}</td>
            <td className="number">{apr(order)}</td>
            <td className="number">{term(order)}</td>
            <td>
              <Identifier
                value={order.borrower}
                label="borrower"
                href={explorer.address(order.borrower)}
                external
              />
            </td>
            <td>
              {order.house ? (
                <Identifier
                  value={order.house}
                  label="house"
                  onClick={() => onHouse(order.house!)}
                />
              ) : (
                <span className="text-[#b3b9bc]">—</span>
              )}
            </td>
            <td className="font-mono text-xs text-[#b3b9bc]">{relativeTime(order.createdAt)}</td>
          </tr>
        ))}
        {!orders.length && (
          <tr>
            <td colSpan={11} className="!p-10 !text-center text-muted">
              {empty ?? "No matching orders."}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
