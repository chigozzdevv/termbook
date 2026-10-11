export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="gutter relative isolate grid grid-cols-[minmax(0,1fr)_minmax(260px,28%)] items-end gap-12 overflow-hidden pt-9 pb-7 max-[980px]:block max-[740px]:pt-8 max-[740px]:pb-[26px] max-[430px]:pt-7 max-[430px]:pb-6"
    >
      <h1
        id="hero-heading"
        className="relative z-1 m-0 max-w-[760px] font-heading text-[58px] leading-[1.12] font-normal tracking-[-1.4px] max-[1100px]:text-[50px] max-[740px]:max-w-[520px] max-[740px]:text-[49px] max-[430px]:text-[38px]"
      >
        Programmable cross-chain
        <br />
        credit for Monad apps.
      </h1>
      <p className="relative z-1 mb-1 max-w-[360px] justify-self-end text-left text-[15px] leading-[1.6] text-[#a4aaad] max-[980px]:mt-[18px] max-[980px]:mb-0 max-[980px]:max-w-[600px] max-[430px]:mt-[17px] max-[430px]:text-sm">
        Borrow with less upfront collateral using SOL, ETH, or MON. The positions you create secure
        the loan.
      </p>
    </section>
  );
}
