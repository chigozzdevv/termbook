export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "code"; language: string; title: string; value: string }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "list"; items: string[]; ordered: boolean }
  | { kind: "note"; title: string; text: string }
  | { kind: "links"; items: { href: string; title: string; description: string }[] }
  | { kind: "flow"; steps: { title: string; text: string }[] };

export type Section = { id: string; title: string; blocks: Block[] };
export type DocPage = { slug: string; group: string; title: string; description: string; sections: Section[] };

export const p = (text: string): Block => ({ kind: "paragraph", text });
export const code = (title: string, value: string, language = "typescript"): Block => ({ kind: "code", title, value: value.trim(), language });
export const table = (columns: string[], rows: string[][]): Block => ({ kind: "table", columns, rows });
export const list = (items: string[], ordered = false): Block => ({ kind: "list", items, ordered });
export const note = (title: string, text: string): Block => ({ kind: "note", title, text });
export const links = (items: { href: string; title: string; description: string }[]): Block => ({ kind: "links", items });
export const flow = (steps: { title: string; text: string }[]): Block => ({ kind: "flow", steps });
export const section = (id: string, title: string, ...blocks: Block[]): Section => ({ id, title, blocks });
export const page = (slug: string, group: string, title: string, description: string, sections: Section[]): DocPage => ({ slug, group, title, description, sections });

export const docHref = (slug: string) => slug ? `/docs/${slug}` : "/docs";
export type SearchEntry = { href: string; title: string; group: string; heading: string; text: string };

export function searchEntries(pages: DocPage[]): SearchEntry[] {
  return pages.flatMap((page) => [
    { href: docHref(page.slug), title: page.title, group: page.group, heading: "", text: page.description },
    ...page.sections.map((section) => ({ href: `${docHref(page.slug)}#${section.id}`, title: page.title,
      group: page.group, heading: section.title, text: section.blocks.flatMap((block) => {
        if (block.kind === "paragraph" || block.kind === "note") return [block.text];
        if (block.kind === "table") return block.rows.flat();
        if (block.kind === "list") return block.items;
        if (block.kind === "flow") return block.steps.flatMap((step) => [step.title, step.text]);
        if (block.kind === "links") return block.items.flatMap((link) => [link.title, link.description]);
        return [block.title];
      }).join(" ") })),
  ]);
}

export function searchDocs(entries: SearchEntry[], query: string): SearchEntry[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return entries.filter((entry) => !entry.heading).slice(0, 8);
  return entries.map((entry, index) => {
    const title = `${entry.title} ${entry.heading}`.toLowerCase();
    const text = `${title} ${entry.group} ${entry.text}`.toLowerCase();
    const score = terms.every((term) => text.includes(term))
      ? terms.reduce((sum, term) => sum + (title.includes(term) ? 8 : 1), 0) : 0;
    return { entry, index, score };
  }).filter((result) => result.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 12).map((result) => result.entry);
}
