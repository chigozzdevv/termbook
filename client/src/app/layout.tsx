import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Chrome } from "@/components/layout/chrome";
import { Providers } from "@/components/layout/providers";
import { inter, redaction } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Termbook",
  description:
    "Programmable cross-chain credit for Monad apps. Borrow with less upfront collateral using SOL, ETH, or MON.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${redaction.variable}`}>
      <body>
        <div className="min-w-0 overflow-x-clip bg-background">
          <Providers>
            <Chrome>{children}</Chrome>
          </Providers>
        </div>
      </body>
    </html>
  );
}
