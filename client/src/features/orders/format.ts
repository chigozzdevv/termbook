import { number } from "@/lib/format";
import type { Order } from "./types";

export const apr = (order: Order) =>
  order.aprBps === null ? "—" : `${number(order.aprBps / 100)}%`;
export const term = (order: Order) => `${number(order.duration / 86400)}d`;
export const collateral = (order: Order) =>
  `${number(Number(order.collateral.amount) / 10 ** order.collateral.decimals)} ${order.collateral.symbol}`;
