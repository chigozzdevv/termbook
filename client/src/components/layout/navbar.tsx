"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export function Navbar() {
  const apps = usePathname().startsWith("/apps");
  return (
    <header className="gutter m-0 flex min-h-[72px] items-center gap-9 border-b border-[#25282a] bg-background max-[740px]:min-h-[66px] max-[740px]:gap-6 max-[520px]:gap-[18px] max-[430px]:min-h-16 max-[430px]:gap-3 max-[350px]:gap-[10px]">
      <Logo />
      <nav
        aria-label="Main navigation"
        className="ml-auto flex items-center gap-6 max-[740px]:gap-3 max-[350px]:gap-2"
      >
        <Link
          href="/docs"
          className="touch-target inline-flex min-h-9 items-center text-[13px] text-[#a4aaad] hover:text-[#f4f4ef] max-[740px]:hidden"
        >
          Docs
        </Link>
        <Link
          href="/apps"
          aria-label="Apps"
          aria-current={apps ? "page" : undefined}
          className={`touch-target inline-flex min-h-9 items-center justify-center gap-2 rounded-none border px-3 text-[13px] whitespace-nowrap hover:border-[#53585b] hover:bg-[#222527] hover:text-[#f4f4ef] max-[430px]:min-h-[38px] max-[430px]:min-w-[38px] max-[430px]:gap-[6px] max-[430px]:px-[10px] max-[430px]:text-xs max-[350px]:gap-0 ${apps ? "border-accent bg-[#262630] text-white" : "border-[#35383b] bg-panel text-[#d7dcde]"}`}
        >
          <LayoutGrid
            aria-hidden="true"
            size={16}
            strokeWidth={1.8}
            className="shrink-0 max-[430px]:size-[14px]"
          />
          <span className="max-[350px]:hidden">Apps</span>
        </Link>
        <Link
          href="/?view=houses#market"
          className="touch-target inline-flex min-h-9 items-center justify-center gap-2 rounded-none border-0 bg-accent px-[14px] text-[13px] font-medium whitespace-nowrap text-white hover:bg-[#6666ff] max-[430px]:min-h-[38px] max-[430px]:gap-[6px] max-[430px]:px-[10px] max-[430px]:text-xs"
        >
          Supply
          <ArrowUpRight aria-hidden="true" size={14} />
        </Link>
      </nav>
    </header>
  );
}
