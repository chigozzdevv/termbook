import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function Card() {
  return (
    <article
      aria-label="Kuru integration"
      className="flex min-w-0 flex-col rounded-xl border border-line bg-[#141718] p-6 max-[430px]:p-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Image
          src="/apps/kuru.svg"
          alt=""
          width={20}
          height={36}
          loading="eager"
          className="h-16 w-auto shrink-0 object-contain"
        />
        <div className="min-w-0">
          <h2 className="text-[22px] leading-[1.2] font-medium tracking-[-.4px]">Kuru</h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>MON / USDC</span>
            <span aria-hidden="true">·</span>
            <span>Monad</span>
          </p>
        </div>
      </div>
      <p className="mt-3 mb-6 text-sm leading-[1.6] text-[#a4aaad]">
        Buy and sell spot assets with your Termbook Credit Account.
      </p>
      <p className="mb-2 text-xs text-muted">Maintained by Termbook</p>
      <Link className="mb-5 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground" href="/app/kuru">termbook.xyz/app/kuru<ArrowUpRight size={12} /></Link>
      <Link
        href="/app/kuru"
        aria-label="View Kuru"
        className="touch-target mt-auto flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-[13px] text-white hover:bg-[#6666ff]"
      >
        View app
      </Link>
    </article>
  );
}
