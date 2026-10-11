import { Blocks } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Integration({ onOpen }: { onOpen: () => void }) {
  return (
    <article
      aria-label="Integrate Termbook"
      className="flex min-w-0 flex-col rounded-xl border border-dashed border-[#3a3e42] p-6 max-[430px]:p-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div aria-hidden="true" className="flex h-16 w-9 shrink-0 items-center justify-center">
          <Blocks size={30} strokeWidth={1.5} className="text-[#b8b8ff]" />
        </div>
        <h2 className="min-w-0 text-[22px] leading-[1.2] font-medium tracking-[-.4px]">
          Integrate Termbook
        </h2>
      </div>
      <p className="mt-3 mb-6 text-sm leading-[1.6] text-[#a4aaad]">
        Bring Termbook credit to your Monad app.
      </p>
      <Button
        variant="secondary"
        onClick={onOpen}
        aria-label="Integrate Termbook"
        aria-haspopup="dialog"
        aria-controls="contact-dialog"
        className="mt-auto w-full py-2.5"
      >
        Get in touch
      </Button>
    </article>
  );
}
