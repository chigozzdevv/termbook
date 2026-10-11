"use client";

import { useDialogs } from "@/components/layout/providers";

export function GetInTouch() {
  const { contact } = useDialogs();
  return (
    <section
      aria-labelledby="contact-title"
      className="flex min-w-0 items-center justify-center rounded-[18px] bg-accent px-9 py-11 text-center text-white max-[980px]:px-7 max-[980px]:py-9 max-[740px]:min-h-[300px] max-[430px]:min-h-[284px] max-[430px]:px-6"
    >
      <div className="min-w-0 max-w-[380px]">
        <h2
          id="contact-title"
          className="m-0 font-heading text-[42px] leading-[1.15] tracking-[-.6px] max-[980px]:text-[38px] max-[430px]:text-[34px]"
        >
          Get in touch
        </h2>
        <p className="mt-6 mb-7 text-[15px] leading-[1.7] text-[#f4f4ef] max-[430px]:text-sm">
          Building a Monad app or looking to supply liquidity? Let’s talk about how Termbook fits.
        </p>
        <button
          type="button"
          onClick={() => contact()}
          aria-haspopup="dialog"
          aria-controls="contact-dialog"
          className="touch-target inline-flex min-h-10 items-center justify-center rounded-[7px] border border-background bg-background px-4 py-[9px] text-[13px] leading-[1.4] font-medium whitespace-nowrap text-[#f4f4ef] hover:border-[#24282b] hover:bg-[#24282b] focus-visible:outline-[#f4f4ef]"
        >
          Talk to us
        </button>
      </div>
    </section>
  );
}
