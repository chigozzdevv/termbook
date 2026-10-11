import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/features/docs/shell";
import { pages } from "@/features/docs/content";
import { searchEntries } from "@/features/docs/model";
import "@/features/docs/docs.css";

export const metadata: Metadata = { title: { default: "Termbook Docs", template: "%s | Termbook Docs" }, description: "Integrate apps, use the SDK and run Termbook credit infrastructure." };

export default function Layout({ children }: { children: ReactNode }) {
  const navigation = pages.map(({ slug, title, group, sections }) => ({ slug, title, group,
    sections: sections.map(({ id, title }) => ({ id, title })) }));
  return <Shell pages={navigation} search={searchEntries(pages)}>{children}</Shell>;
}
