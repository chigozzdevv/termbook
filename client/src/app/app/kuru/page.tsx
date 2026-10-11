import type { Metadata } from "next";
import { KuruPage } from "@/features/kuru/page";
import "@/features/kuru/kuru.css";

export const metadata: Metadata = { title: "Kuru · Termbook", description: "Trade MON and USDC with your Termbook Credit Account." };
export default function Page() { return <KuruPage />; }
