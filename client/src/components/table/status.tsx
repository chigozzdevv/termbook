import {
  CheckCheck,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleX,
  Clock,
  Hourglass,
  LockKeyhole,
  RotateCcw,
  ShieldEllipsis,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { statusLabel } from "@/lib/format";

const green = "border-[#087940] bg-[#082619] text-success";
const amber = "border-[#9c4c00] bg-[#352000] text-[#ffb000]";
const blue = "border-[#2d5a92] bg-[#101f32] text-[#7eb5ff]";
const red = "border-[#8a3643] bg-[#30181d] text-danger";
const styles: Record<string, [string, LucideIcon]> = {
  active: [green, CircleCheck],
  ready: [green, CircleCheck],
  closed: [green, CheckCheck],
  reserved: [amber, LockKeyhole],
  collateral_locking: [amber, LockKeyhole],
  collateral_proving: [blue, ShieldEllipsis],
  account_creating: [blue, Wallet],
  paused: [amber, CirclePause],
  closing: [amber, Hourglass],
  expired: ["", Clock],
  aborted: ["", CircleX],
  recovery_pending: [amber, RotateCcw],
  liquidating: [red, TriangleAlert],
  liquidated: [red, CircleX],
};

export function Status({ value }: { value: string }) {
  const [tone, Icon] = styles[value] ?? ["", CircleDashed];
  return (
    <span
      className={`inline-flex items-center gap-[6px] rounded-2xl border px-[7px] py-[2px] font-mono text-xs leading-[1.15] whitespace-nowrap ${tone || "border-[#414547] bg-[#1c1e1f] text-[#a6adb2]"}`}
    >
      <Icon aria-hidden="true" size={13} strokeWidth={1.8} />
      {statusLabel(value)}
    </span>
  );
}
