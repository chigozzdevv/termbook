const steps = [
  ["Choose your credit", "Accept a House offer with the amount, rate, and term that work for you."],
  ["Lock collateral", "Lock SOL, ETH, or MON on its supported chain to activate your credit."],
  [
    "Use Monad apps",
    "Use your credit in supported Monad apps. The positions you create secure the loan.",
  ],
];

export function HowItWorks() {
  return (
    <section
      aria-labelledby="how-title"
      className="min-w-0 rounded-[18px] border border-line p-[34px] max-[980px]:p-7 max-[430px]:px-[22px] max-[430px]:py-6"
    >
      <h2
        id="how-title"
        className="m-0 font-heading text-[42px] leading-[1.15] tracking-[-.6px] max-[980px]:text-[38px] max-[430px]:text-[34px]"
      >
        How it works
      </h2>
      <ol className="mt-[30px] grid list-none gap-6 p-0">
        {steps.map(([title, text], index) => (
          <li
            key={title}
            className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-[14px] max-[430px]:grid-cols-[28px_minmax(0,1fr)] max-[430px]:gap-3"
          >
            <span
              aria-hidden="true"
              className="font-heading text-[28px] leading-[1.2] text-[#8888ff]"
            >
              0{index + 1}
            </span>
            <div>
              <h3 className="mb-[6px] text-base leading-[1.4] font-medium">{title}</h3>
              <p className="m-0 max-w-[440px] text-sm leading-[1.6] text-[#a4aaad] max-[430px]:text-[13px]">
                {text}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <a
        href="https://github.com/chigozzdevv/termbook#readme"
        target="_blank"
        rel="noopener noreferrer"
        className="touch-target mt-7 inline-flex min-h-10 items-center justify-center rounded-[7px] border border-[#393d40] bg-transparent px-4 py-[9px] text-[13px] leading-[1.4] font-medium whitespace-nowrap no-underline hover:border-[#687074] hover:bg-[#181b1d]"
      >
        Learn more
      </a>
    </section>
  );
}
