"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Navbar } from "./navbar";
import { Footer } from "./footer";

export function Chrome({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path === "/docs" || path.startsWith("/docs/")) return children;
  return <><Navbar />{children}<Footer /></>;
}
