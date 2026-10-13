import type { SortState } from "@/components/table/sort";
import type { House } from "@/features/houses/types";
import type { Order } from "@/features/orders/types";

interface Filters {
  query: string;
  status: string;
  sort: SortState;
}

const numeric = new Set([
  "availableCash",
  "committedCash",
  "drawnPrincipal",
  "totalAssets",
  "sharePrice",
  "limit",
  "debt",
  "aprBps",
  "duration",
]);

function compare(left: unknown, right: unknown, sort: SortState): number {
  return (
    sort.direction *
    (numeric.has(sort.key)
      ? compareUnits(left, right)
      : String(left).localeCompare(String(right)))
  );
}

function compareUnits(left: unknown, right: unknown): number {
  const a = BigInt(String(left ?? 0)), b = BigInt(String(right ?? 0));
  return a < b ? -1 : a > b ? 1 : 0;
}

export function filterOrders(orders: Order[], { query, status, sort }: Filters): Order[] {
  const key = sort.key in (orders[0] ?? {}) ? (sort.key as keyof Order) : "createdAt";
  return orders
    .filter(
      (order) =>
        (status === "all" || order.status === status) &&
        [
          order.id,
          order.intentId,
          order.borrower,
          order.house,
          order.collateral.symbol,
          order.collateral.chain.label,
          order.kind,
          order.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((left, right) => compare(left[key], right[key], { ...sort, key }));
}

export function filterHouses(houses: House[], { query, status, sort }: Filters): House[] {
  const key = sort.key in (houses[0] ?? {}) ? (sort.key as keyof House) : "availableCash";
  return houses
    .filter(
      (house) =>
        (status === "all" || (!house.active ? "inactive" : house.paused ? "paused" : "active") === status) &&
        [house.house, house.vault, house.manager, house.assetSymbol, !house.active ? "inactive" : house.paused ? "paused" : "active"]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((left, right) => compare(left[key], right[key], { ...sort, key }));
}
