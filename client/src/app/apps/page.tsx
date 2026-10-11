import { Grid } from "@/features/apps/grid";

export default function Page() {
  return (
    <main className="gutter min-h-[calc(100dvh-190px)] pt-12 pb-[72px] max-[740px]:pt-8 max-[740px]:pb-12">
      <div className="mb-8">
        <h1 className="mb-3 font-heading text-5xl leading-[1.12] tracking-[-1px] max-[740px]:text-[40px]">
          Apps
        </h1>
        <p className="text-[15px] leading-[1.6] text-muted">Use your credit in Monad apps.</p>
      </div>
      <Grid />
    </main>
  );
}
