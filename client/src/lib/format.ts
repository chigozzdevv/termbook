import { formatUnits } from "viem";

export function short(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

export function money(value: string, decimals = 6): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(formatUnits(BigInt(value), decimals)));
}

export function relativeTime(date: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 1000));
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function dateTime(date: string | number): string {
  return `${new Date(date).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} WAT`;
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    collateral_proving: "Proving", recovery_pending: "Recovery",
    collateral_locking: "Locking", account_creating: "Creating account",
  };
  return labels[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}
