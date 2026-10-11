import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Article } from "@/features/docs/article";
import { findPage, pages } from "@/features/docs/content";

type Props = { params: Promise<{ slug: string[] }> };

export function generateStaticParams() {
  return pages.filter((page) => page.slug).map((page) => ({ slug: page.slug.split("/") }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findPage((await params).slug.join("/"));
  if (!page) notFound();
  return { title: page.title, description: page.description };
}

export default async function Page({ params }: Props) {
  const page = findPage((await params).slug.join("/"));
  if (!page) notFound();
  const index = pages.indexOf(page);
  return <Article page={page} previous={pages[index - 1]} next={pages[index + 1]} />;
}
