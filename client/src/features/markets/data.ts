import { explorerHouseSchema, explorerOrderSchema, explorerPageSchema } from "@termbook/schema";
import { protocol } from "@/lib/api";
import type { Order } from "@/features/orders/types";

export async function readOrders(signal?: AbortSignal) {
  const records = new Map<string, Order>();
  const cursors = new Set<string>();
  let next: string | null = null;
  let total = 0;
  let snapshot: ReturnType<typeof explorerPageSchema.parse>["snapshot"];
  do {
    const query = new URLSearchParams();
    if (next) query.set("cursor", next);
    if (snapshot) query.set("snapshot", snapshot.generation);
    const page = explorerPageSchema.parse(await protocol(`/explorer/orders${query.size ? `?${query}` : ""}`, signal));
    if (snapshot && page.snapshot?.generation !== snapshot.generation) throw new Error("Explorer snapshot changed");
    snapshot ??= page.snapshot;
    for (const order of page.records) records.set(order.id, order);
    total = page.total;
    next = page.next;
    if (next && (cursors.has(next) || page.records.length === 0)) throw new Error("Invalid explorer page");
    if (next) cursors.add(next);
    if (cursors.size > 100) throw new Error("Explorer history is too large");
  } while (next);
  if (records.size !== total) throw new Error("Explorer history is incomplete");
  return { records: [...records.values()], total, ...(snapshot ? { snapshot } : {}) };
}
export const readHouses = async (signal?: AbortSignal) => explorerHouseSchema.array().parse(await protocol("/explorer/houses", signal));
export const readOrder = async (id: string) => explorerOrderSchema.parse(await protocol(`/explorer/orders/${encodeURIComponent(id)}`));
export const readHouse = async (address: string) => explorerHouseSchema.parse(await protocol(`/explorer/houses/${encodeURIComponent(address)}`));
