"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Network } from "./network";

export function Navbar() {
  const path = usePathname();
  const apps = path.startsWith("/apps") || path.startsWith("/app/");
  return (
    <header className="gutter site-header site-navbar m-0 min-h-[72px] border-b border-[#25282a] bg-background max-[740px]:min-h-16 max-[740px]:px-4">
      <Logo />
      <Network />
      <nav
        aria-label="Main navigation"
        className="site-actions flex items-center gap-6 max-[740px]:gap-2"
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
          className={`touch-target inline-flex min-h-9 items-center justify-center gap-2 rounded-none border px-3 text-[13px] whitespace-nowrap hover:border-[#53585b] hover:bg-[#222527] hover:text-[#f4f4ef] max-[740px]:size-11 max-[740px]:gap-0 max-[740px]:px-0 ${apps ? "border-accent bg-[#262630] text-white" : "border-[#35383b] bg-panel text-[#d7dcde]"}`}
        >
          <LayoutGrid
            aria-hidden="true"
            size={16}
            strokeWidth={1.8}
            className="shrink-0"
          />
          <span className="max-[740px]:hidden">Apps</span>
        </Link>
        <Link
          href="/houses"
          className="touch-target inline-flex min-h-9 items-center justify-center gap-2 rounded-none border-0 bg-accent px-[14px] text-[13px] font-medium whitespace-nowrap text-white hover:bg-[#6666ff] max-[430px]:min-h-11 max-[430px]:gap-[6px] max-[430px]:px-[10px] max-[430px]:text-xs"
        >
          Supply
          <ArrowUpRight aria-hidden="true" size={14} className="max-[350px]:hidden" />
        </Link>
      </nav>
    </header>
  );
}
