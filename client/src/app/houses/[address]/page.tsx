import { notFound } from "next/navigation";
import { readHouse, readOrders } from "@/features/markets/data";
import { ApiError } from "@/lib/api";
import { Unavailable } from "@/features/markets/unavailable";
import { Page as HousePage } from "@/features/houses/page";

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) notFound();
  const data = await Promise.all([readHouse(address), readOrders()]).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    return null;
  });
  if (!data) return <Unavailable label="House" href="/houses" />;
  return <HousePage house={data[0]} orders={data[1].records} />;
}
