import Link from "next/link";
import { Plus } from "lucide-react";
import { Explorer } from "@/features/markets/explorer";

export default function Page() {
  return (
    <main className="gutter mx-auto max-w-[1600px] py-9 max-[430px]:py-6">
      <div className="mb-8">
        <div className="flex items-center justify-between gap-4">
          <h1 id="houses-tab" className="mb-2 font-heading text-[36px] leading-[1.1]">
            Houses
          </h1>
          <Link
            href="/houses/create"
            className="touch-target inline-flex min-h-[38px] shrink-0 items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] text-white hover:bg-[#6666ff] max-[430px]:text-xs"
          >
            <Plus size={15} aria-hidden="true" />
            Create House
          </Link>
        </div>
        <p className="mt-3 text-[13px] text-muted">Supply liquidity to fund app credit on Monad.</p>
      </div>
      <Explorer view="houses" />
    </main>
  );
}
