"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDialogs } from "@/components/layout/providers";
import { Toolbar } from "@/components/table/toolbar";
import type { SortState } from "@/components/table/sort";
import { Table as OrdersTable } from "@/features/orders/table";
import { Table as HousesTable } from "@/features/houses/table";
import { Details as HouseDetails } from "@/features/houses/details";
import { orders } from "@/features/orders/mock";
import { houses } from "@/features/houses/mock";
import { short } from "@/lib/format";
import { filterHouses, filterOrders } from "./filter";

export type View = "orders" | "houses";
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

export function Explorer({ view = "orders", tabbed = false }: { view?: View; tabbed?: boolean }) {
  const router = useRouter();
  const { supply } = useDialogs();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortState>({
    key: view === "houses" ? "availableCash" : "createdAt",
    direction: -1,
  });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const filteredOrders = filterOrders(orders, { query, status, sort });
  const filteredHouses = filterHouses(houses, { query, status, sort });
  const count = view === "houses" ? filteredHouses.length : filteredOrders.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const start = currentPage * pageSize;
  const house = houses.find((house) => house.house === selected);

  function select(id: string) {
    setSelected(selected === id ? null : id);
  }
  function onSort(key: string) {
    setSort({ key, direction: sort.key === key ? (sort.direction === 1 ? -1 : 1) : -1 });
  }

  return (
    <div>
      <div id="records" role={tabbed ? "tabpanel" : "region"} aria-labelledby={`${view}-tab`}>
        <Toolbar
          label={view === "houses" ? "Houses" : "borrowing orders"}
          query={query}
          onQuery={(value) => {
            setQuery(value);
            setPage(0);
            setSelected(null);
          }}
          count={count}
          status={status}
          statuses={view === "houses" ? ["active", "paused"] : statuses}
          onStatus={(value) => {
            setStatus(value);
            setPage(0);
            setSelected(null);
          }}
          page={currentPage}
          pages={pages}
          onPage={setPage}
        />
        <div className="overflow-x-auto rounded-[18px] border border-line bg-panel">
          {view === "houses" ? (
            <HousesTable
              houses={filteredHouses.slice(start, start + pageSize)}
              sort={sort}
              onSort={onSort}
              onSupply={supply}
            />
          ) : (
            <OrdersTable
              orders={filteredOrders.slice(start, start + pageSize)}
              sort={sort}
              onSort={onSort}
              onHouse={select}
            />
          )}
        </div>
        <div className="mt-3 flex justify-between gap-3 text-xs text-[#747e83] max-[430px]:flex-wrap">
          <span>
            {count ? start + 1 : 0}–{Math.min(start + pageSize, count)} of {count}{" "}
            {view === "houses" ? "Houses" : "Orders"}
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
                onClick={() => setSelected(null)}
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
