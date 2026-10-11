import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, Hash, List } from "lucide-react";
import { Code } from "./code";
import { Diagram } from "./diagram";
import { docHref, type Block, type DocPage } from "./model";

function Content({ block }: { block: Block }) {
  switch (block.kind) {
    case "paragraph": return <p>{block.text}</p>;
    case "code": return <Code {...block} />;
    case "table": return <div className="docs-table-scroll" role="region" aria-label={block.columns.join(", ")} tabIndex={0}>
      <table><thead><tr>{block.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>
          {typeof cell === "string" ? cell : <a className="docs-explorer-link" href={cell.href} target="_blank" rel="noopener noreferrer" aria-label={cell.label}>
            <span>{cell.text}</span><ArrowUpRight size={15} aria-hidden="true" />
          </a>}
        </td>)}</tr>)}</tbody>
      </table>
    </div>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return <Tag>{block.items.map((item) => <li key={item}>{item}</li>)}</Tag>;
    }
    case "note": return <aside className="docs-note"><strong>{block.title}</strong><p>{block.text}</p></aside>;
    case "links": return <div className="docs-links">{block.items.map((link) => <Link key={link.href} href={link.href}>
      <span className="docs-link-title">{link.title}<ArrowUpRight size={16} /></span>
      <span>{link.description}</span>
    </Link>)}</div>;
    case "diagram": return <Diagram {...block} />;
  }
}

export function Article({ page, previous, next }: { page: DocPage; previous?: DocPage; next?: DocPage }) {
  return <main id="docs-content" className="docs-article" tabIndex={-1}>
    <header className="docs-page-header">
      <span className="docs-eyebrow">{page.group}</span>
      <h1>{page.title}</h1>
      <p>{page.description}</p>
    </header>
    <details className="docs-mobile-toc">
      <summary><List size={15} />On this page<ChevronDown size={14} /></summary>
      <nav aria-label="Page sections">{page.sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav>
    </details>
    {page.sections.map((section) => <section key={section.id} aria-labelledby={section.id}>
      <h2 id={section.id} aria-label={section.title}><a href={`#${section.id}`} aria-label={`Link to ${section.title}`}><Hash size={18} /></a>{section.title}</h2>
      {section.blocks.map((block, index) => <Content key={index} block={block} />)}
    </section>)}
    <nav className="docs-pagination" aria-label="Previous and next pages">
      {previous ? <Link href={docHref(previous.slug)}><span><ArrowLeft size={14} />Previous</span><strong>{previous.title}</strong></Link> : <span />}
      {next && <Link href={docHref(next.slug)}><span>Next<ArrowRight size={14} /></span><strong>{next.title}</strong></Link>}
    </nav>
    <footer className="docs-article-footer">
      <span>Termbook documentation</span>
      <a href="https://github.com/chigozzdevv/termbook/tree/main/client/src/features/docs/content" target="_blank" rel="noopener noreferrer">View source<ArrowUpRight size={13} /></a>
    </footer>
  </main>;
}
