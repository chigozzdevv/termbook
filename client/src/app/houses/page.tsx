import { Explorer } from "@/features/markets/explorer";
import { CreateButton } from "@/features/houses/create-button";

export default function Page() {
  return (
    <main className="gutter mx-auto max-w-[1600px] py-9 max-[430px]:py-6">
      <div className="mb-8">
        <div className="flex items-center justify-between gap-4">
          <h1 id="houses-tab" className="mb-2 font-heading text-[36px] leading-[1.1]">
            Houses
          </h1>
          <CreateButton />
        </div>
        <p className="mt-3 text-[13px] text-muted">Supply liquidity to fund app credit on Monad.</p>
      </div>
      <Explorer view="houses" />
    </main>
  );
}
