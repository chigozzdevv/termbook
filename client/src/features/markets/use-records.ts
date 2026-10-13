"use client";

import { useEffect, useState } from "react";
import type { House } from "@/features/houses/types";
import type { Order } from "@/features/orders/types";
import { readHouses, readOrders } from "./data";

export function useRecords() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [totalOrders, setTotalOrders] = useState<number>();
  const [loading, setLoading] = useState({ orders: true, houses: true });
  const [error, setError] = useState({ orders: "", houses: "" });
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      await Promise.all([
        readOrders(abort.signal).then((data) => { if (active) { setOrders(data.records); setTotalOrders(data.total); setError((prior) => ({ ...prior, orders: "" })); } })
          .catch(() => { if (active) setError((prior) => ({ ...prior, orders: "Orders could not be refreshed." })); })
          .finally(() => { if (active) setLoading((prior) => ({ ...prior, orders: false })); }),
        readHouses(abort.signal).then((data) => { if (active) { setHouses(data); setError((prior) => ({ ...prior, houses: "" })); } })
          .catch(() => { if (active) setError((prior) => ({ ...prior, houses: "House balances could not be refreshed." })); })
          .finally(() => { if (active) setLoading((prior) => ({ ...prior, houses: false })); }),
      ]);
      if (active) timer = setTimeout(refresh, 30_000);
    }
    void refresh();
    return () => { active = false; abort.abort(); clearTimeout(timer); };
  }, []);
  return { orders, houses, totalOrders, loading, error };
}
