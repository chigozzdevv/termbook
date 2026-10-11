import { notFound } from "next/navigation";
import { houses } from "@/features/houses/mock";
import { Page as HousePage } from "@/features/houses/page";

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const house = houses.find((house) => house.house === address);
  if (!house) notFound();
  return <HousePage house={house} />;
}
