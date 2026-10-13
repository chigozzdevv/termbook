import { Hero } from "@/features/landing/hero";
import { HowItWorks } from "@/features/landing/how-it-works";
import { GetInTouch } from "@/features/landing/get-in-touch";
import { Explorer } from "@/features/markets/explorer";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if ((await searchParams).view === "houses") redirect("/houses");
  return (
    <>
      <Hero />
      <main id="market" className="gutter scroll-mt-5 pb-[30px] max-[740px]:pb-[22px]">
        <div className="mb-5 flex items-center justify-between">
          <h2 id="orders-tab" className="text-[17px]">
            Orders
          </h2>
          <Link href="/houses" className="text-[13px] text-muted hover:text-foreground">
            Houses
          </Link>
        </div>
        <Explorer />
        <div className="grid grid-cols-2 items-stretch gap-6 pt-[76px] pb-[52px] max-[740px]:grid-cols-1 max-[740px]:gap-5 max-[740px]:pt-14 max-[740px]:pb-8">
          <HowItWorks />
          <GetInTouch />
        </div>
      </main>
    </>
  );
}
