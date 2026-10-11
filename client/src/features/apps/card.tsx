import Image from "next/image";
import { Button } from "@/components/ui/button";

export function Card({ onOpen }: { onOpen: () => void }) {
  return (
    <article
      aria-label="Kuru integration"
      className="flex min-w-0 flex-col rounded-xl border border-line bg-[#141718] p-6 max-[430px]:p-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Image
          src="/apps/kuru.svg"
          alt=""
          width={36}
          height={64}
          loading="eager"
          className="h-16 w-9 shrink-0 object-contain"
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
      <Button
        onClick={onOpen}
        aria-label="View Kuru"
        aria-haspopup="dialog"
        aria-controls="kuru-dialog"
        className="mt-auto w-full py-2.5"
      >
        View app
      </Button>
    </article>
  );
}
