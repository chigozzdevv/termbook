import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { Status } from "@/components/table/status";
import { orders } from "@/features/orders/mock";
import { Details } from "@/features/orders/details";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = orders.find((order) => order.id.toLowerCase() === id.toLowerCase());
  if (!order) notFound();
  const title = order.kind === "request" ? "Borrowing request" : "Credit";
  return (
    <main className="gutter order-page">
      <div className="mx-auto max-w-[1160px]">
        <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-2 text-xs text-muted">
          <Link href="/#market" className="hover:text-foreground">
            Orders
          </Link>
          <ChevronRight size={12} aria-hidden="true" />
          <span aria-current="page">{title}</span>
        </nav>
        <header className="mb-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h1 className="m-0 font-heading text-[34px] leading-[1.15] max-[430px]:text-[28px]">
              {title}
            </h1>
            <Status value={order.status} />
          </div>
          <div className="flex min-w-0 items-start gap-2 text-muted">
            <span className="min-w-0 pt-1 font-mono text-xs leading-[1.6] wrap-anywhere">
              {order.id}
            </span>
            <CopyButton
              value={order.id}
              label={order.kind === "request" ? "intent ID" : "credit ID"}
            />
          </div>
        </header>
        <Details order={order} />
      </div>
    </main>
  );
}
