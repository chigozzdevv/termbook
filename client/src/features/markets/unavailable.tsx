"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function Unavailable({ label, href }: { label: string; href: string }) {
  const router = useRouter();
  return <main className="gutter mx-auto max-w-[1160px] py-9">
    <h1 className="font-heading text-[28px]">{label} unavailable</h1>
    <p className="my-4 text-sm text-muted">The latest data could not be loaded.</p>
    <div className="flex items-center gap-4">
      <button type="button" className="rounded-lg bg-accent px-4 py-2 text-sm text-white" onClick={() => router.refresh()}>Try again</button>
      <Link href={href} className="text-sm text-muted">Back</Link>
    </div>
  </main>;
}
