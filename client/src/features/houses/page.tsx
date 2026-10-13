"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { orders } from "@/features/orders/mock";
import { short } from "@/lib/format";
import { Details } from "./details";
import type { House } from "./types";

export function Page({ house }: { house: House }) {
  const router = useRouter();
  return (
    <main className="gutter py-8">
      <Link
        href="/houses"
        className="mb-5 inline-block text-muted underline underline-offset-4"
      >
        Back to Houses
      </Link>
      <section className="rounded-2xl border border-line bg-[#151719] p-5">
        <h1 className="mb-5 font-heading text-[28px] leading-[1.15]">House {short(house.house)}</h1>
        <Details house={house} orders={orders} onOrder={(id) => router.push(`/orders/${id}`)} />
      </section>
    </main>
  );
}
