import { Hero } from "@/features/landing/hero";
import { HowItWorks } from "@/features/landing/how-it-works";
import { GetInTouch } from "@/features/landing/get-in-touch";
import { Explorer } from "@/features/markets/explorer";
import { Tabs } from "@/features/markets/tabs";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view === "houses" ? "houses" : "orders";
  return (
    <>
      <Hero />
      <main id="market" className="gutter scroll-mt-5 pb-[30px] max-[740px]:pb-[22px]">
        <Tabs view={view} />
        <Explorer key={view} view={view} tabbed />
        <div className="grid grid-cols-2 items-stretch gap-6 pt-[76px] pb-[52px] max-[740px]:grid-cols-1 max-[740px]:gap-5 max-[740px]:pt-14 max-[740px]:pb-8">
          <HowItWorks />
          <GetInTouch />
        </div>
      </main>
    </>
  );
}
