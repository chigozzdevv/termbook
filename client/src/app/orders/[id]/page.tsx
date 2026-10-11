import Link from "next/link";
import { notFound } from "next/navigation";
import { orders } from "@/features/orders/mock";
import { Details, detailTitle } from "@/features/orders/details";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = orders.find((order) => order.id === id);
  if (!order) notFound();
  return (
    <main className="gutter py-8">
      <Link href="/" className="mb-5 inline-block text-muted underline underline-offset-4">
        Back to Orders
      </Link>
      <section className="rounded-2xl border border-line bg-[#151719] p-5">
        <h1 className="mb-5 font-heading text-[28px] leading-[1.15]">{detailTitle(order)}</h1>
        <Details order={order} />
      </section>
    </main>
  );
}
