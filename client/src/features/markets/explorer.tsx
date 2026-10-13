"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDialogs } from "@/components/layout/providers";
import { Toolbar } from "@/components/table/toolbar";
import type { SortState } from "@/components/table/sort";
import { Table as OrdersTable } from "@/features/orders/table";
import { Table as HousesTable } from "@/features/houses/table";
import { Details as HouseDetails } from "@/features/houses/details";
import { Stats as HouseStats } from "@/features/houses/stats";
import { short } from "@/lib/format";
import { filterHouses, filterOrders } from "./filter";
import { useRecords } from "./use-records";
import { Tabs } from "./tabs";

export type View = "orders" | "houses";
type Filters = {
  query: string;
  status: string;
  sort: SortState;
  page: number;
  selected: string | null;
};
const initialFilters = (view: View): Filters => ({
  query: "",
  status: "all",
  sort: { key: view === "houses" ? "availableCash" : "createdAt", direction: -1 },
  page: 0,
  selected: null,
});
const pageSize = 12;
const statuses = [
  "open",
  "reserved",
  "collateral_proving",
  "ready",
  "closing",
  "closed",
  "liquidating",
  "expired",
];

export function Explorer({ view = "orders", tabs, stats }: { view?: View; tabs?: boolean; stats?: boolean }) {
  const router = useRouter();
  const { supply } = useDialogs();
  const data = useRecords();
  const { orders, houses } = data;
  const loading = data.loading[view];
  const error = data.error[view];
  const empty = loading ? "Loading records…" : error ? "Data is unavailable. Retrying…" : undefined;
  const [filters, setFilters] = useState<Record<View, Filters>>({
    orders: initialFilters("orders"),
    houses: initialFilters("houses"),
  });
  const { query, status, sort, page, selected } = filters[view];
  function update(values: Partial<Filters>) {
    setFilters((current) => ({ ...current, [view]: { ...current[view], ...values } }));
  }
  const filteredOrders = filterOrders(orders, { query, status, sort });
  const filteredHouses = filterHouses(houses, { query, status, sort });
  const count = view === "houses" ? filteredHouses.length : filteredOrders.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const start = currentPage * pageSize;
  const house = houses.find((house) => house.house === selected);

  function select(id: string) {
    update({ selected: selected === id ? null : id });
  }
  function onSort(key: string) {
    update({ sort: { key, direction: sort.key === key ? (sort.direction === 1 ? -1 : 1) : -1 } });
  }

  return (
    <div>
      {stats && view === "houses" && <HouseStats houses={houses} orders={orders} loading={loading}
        unavailable={!!error} creditsUnavailable={data.loading.orders || !!data.error.orders} />}
      <Toolbar
        tabs={tabs ? <Tabs view={view} orders={data.totalOrders} houses={data.loading.houses || data.error.houses && !houses.length ? undefined : houses.length} /> : undefined}
        label={view === "houses" ? "Houses" : "borrowing orders"}
        query={query}
        onQuery={(value) => {
          update({ query: value, page: 0, selected: null });
        }}
        count={loading || error && !count ? undefined : count}
        status={status}
        statuses={view === "houses" ? ["active", "paused", "inactive"] : statuses}
        onStatus={(value) => {
          update({ status: value, page: 0, selected: null });
        }}
        page={currentPage}
        pages={pages}
        onPage={(page) => update({ page })}
      />
      <div id="records" role={tabs ? "tabpanel" : "region"} aria-labelledby={`${view}-tab`}>
        <div className="overflow-x-auto rounded-[18px] border border-line bg-panel">
          {view === "houses" ? (
            <HousesTable
              houses={filteredHouses.slice(start, start + pageSize)}
              sort={sort}
              onSort={onSort}
              onSupply={supply}
              unavailable={!!error}
              empty={empty}
            />
          ) : (
            <OrdersTable
              orders={filteredOrders.slice(start, start + pageSize)}
              sort={sort}
              onSort={onSort}
              onHouse={select}
              empty={empty}
            />
          )}
        </div>
        <div className="mt-3 flex justify-between gap-3 text-xs text-[#747e83] max-[430px]:flex-wrap">
          <span>
            {loading ? "Loading…" : error || `${count ? start + 1 : 0}–${Math.min(start + pageSize, count)} of ${count} ${view === "houses" ? "Houses" : "Orders"}`}
          </span>
        </div>
        {house && (
          <section
            aria-live="polite"
            className="mt-5 rounded-2xl border border-line bg-[#151719] p-5"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="m-0 font-heading text-[28px] leading-[1.15]">
                House {short(house.house)}
              </h2>
              <button
                type="button"
                onClick={() => update({ selected: null })}
                className="rounded-lg border border-line bg-transparent px-[10px] py-[7px] text-xs"
              >
                Close
              </button>
            </div>
            <HouseDetails
              house={house}
              orders={orders}
              onOrder={(id) => router.push(`/orders/${id}`)}
            />
          </section>
        )}
      </div>
    </div>
  );
}
