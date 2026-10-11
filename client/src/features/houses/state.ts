import type { House } from "./types";

export function depositState(house: House): string {
  if (house.paused) return "Paused";
  if (!house.depositsOpen) return "Closed";
  if (BigInt(house.unresolvedCreditImpairment) !== 0n) return "Restricted";
  return "Open";
}

export function canSupply(house: House): boolean {
  return house.active && depositState(house) === "Open";
}

export function sharePrice(house: House): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(Number(house.sharePrice) / 1e18);
}
