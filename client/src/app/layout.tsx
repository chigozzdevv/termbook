import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Chrome } from "@/components/layout/chrome";
import { Providers } from "@/components/layout/providers";
import { WalletProvider } from "@/features/wallet/use-wallet";
import { inter, redaction } from "./fonts";
import "./globals.css";

const description =
  "Programmable cross-chain credit for Monad apps. Borrow with less upfront collateral using SOL, ETH, or MON.";

export const metadata: Metadata = {
  metadataBase: new URL("https://termbook.xyz"),
  title: "Termbook",
  description,
  openGraph: {
    type: "website",
    siteName: "Termbook",
    title: "Termbook",
    description,
    images: [
      {
        url: "/brand/cover.png",
        width: 1200,
        height: 630,
        alt: "Termbook — programmable cross-chain credit for Monad apps",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Termbook",
    description,
    images: ["/brand/cover.png"],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${redaction.variable}`}>
      <body>
        <div className="min-w-0 overflow-x-clip bg-background">
          <WalletProvider>
            <Providers>
              <Chrome>{children}</Chrome>
            </Providers>
          </WalletProvider>
        </div>
      </body>
    </html>
  );
}
