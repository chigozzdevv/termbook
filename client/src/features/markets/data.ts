import { explorerHouseSchema, explorerOrderSchema, explorerPageSchema } from "@termbook/schema";
import { protocol } from "@/lib/api";
import type { Order } from "@/features/orders/types";

export async function readOrders(signal?: AbortSignal) {
  const records = new Map<string, Order>();
  const cursors = new Set<string>();
  let next: string | null = null;
  let total = 0;
  do {
    const page = explorerPageSchema.parse(await protocol(`/explorer/orders${next ? `?cursor=${next}` : ""}`, signal));
    for (const order of page.records) records.set(order.id, order);
    total = page.total;
    next = page.next;
    if (next && (cursors.has(next) || page.records.length === 0)) throw new Error("Invalid explorer page");
    if (next) cursors.add(next);
    if (cursors.size > 100) throw new Error("Explorer history is too large");
  } while (next);
  return { records: [...records.values()], total };
}
export const readHouses = async (signal?: AbortSignal) => explorerHouseSchema.array().parse(await protocol("/explorer/houses", signal));
export const readOrder = async (id: string) => explorerOrderSchema.parse(await protocol(`/explorer/orders/${encodeURIComponent(id)}`));
export const readHouse = async (address: string) => explorerHouseSchema.parse(await protocol(`/explorer/houses/${encodeURIComponent(address)}`));
