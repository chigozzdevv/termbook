import { number } from "@/lib/format";
import type { Order } from "./types";

export const apr = (order: Order) =>
  order.aprBps === null ? "—" : `${number(order.aprBps / 100)}%`;
export const term = (order: Order) => {
  const [unit, label] = order.duration >= 86400 ? [86400, "d"] : order.duration >= 3600 ? [3600, "h"]
    : order.duration >= 60 ? [60, "m"] : [1, "s"];
  return `${number(order.duration / Number(unit))}${label}`;
};
export const collateral = (order: Order) =>
  `${number(Number(order.collateral.amount) / 10 ** order.collateral.decimals)} ${order.collateral.symbol}`;
