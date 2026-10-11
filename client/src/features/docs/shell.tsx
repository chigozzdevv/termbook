"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, CodeXml, List, Menu, Moon, Search, Sun, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { docHref, searchDocs, type SearchEntry } from "./model";
import { useDocsTheme } from "./theme";

type NavPage = { slug: string; title: string; group: string; sections: { id: string; title: string }[] };
type Props = { children: ReactNode; pages: NavPage[]; search: SearchEntry[] };

export function Shell({ children, pages, search }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const current = pages.find((page) => docHref(page.slug) === pathname);
  const theme = useDocsTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [active, setActive] = useState("");
  const searchDialog = useRef<HTMLDialogElement>(null);
  const menuDialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsList = useRef<HTMLDivElement>(null);
  const results = searchDocs(search, query);
  const groups = [...new Set(pages.map((page) => page.group))];

  function openSearch() {
    setMenuOpen(false);
    setQuery("");
    setSelected(0);
    setSearchOpen(true);
  }

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMenuOpen(false);
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);

  useEffect(() => {
    const dialog = searchDialog.current;
    if (!dialog) return;
    if (searchOpen && !dialog.open) { dialog.showModal(); searchInput.current?.focus(); }
    if (!searchOpen && dialog.open) dialog.close();
  }, [searchOpen]);

  useEffect(() => {
    const dialog = menuDialog.current;
    if (!dialog) return;
    if (menuOpen && !dialog.open) dialog.showModal();
    if (!menuOpen && dialog.open) dialog.close();
  }, [menuOpen]);

  useEffect(() => {
    resultsList.current?.querySelector(`[data-result="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    if (!current) return;
    document.querySelector<HTMLAnchorElement>(".docs-sidebar [aria-current='page']")?.scrollIntoView({ block: "nearest" });
    const update = () => {
      const headings = current.sections.map((section) => document.getElementById(section.id)).filter((node) => node !== null);
      const passed = headings.filter((heading) => heading.getBoundingClientRect().top <= 150);
      const id = passed.at(-1)?.id ?? headings[0]?.id ?? "";
      setActive(id);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [current]);

  function toggleTheme() {
    try {
      localStorage.setItem("termbook.docs.theme", theme === "dark" ? "light" : "dark");
      window.dispatchEvent(new Event("termbook-docs-theme"));
    } catch { /* Storage can be unavailable in private browsing. */ }
  }

  function selectResult(href: string) { setSearchOpen(false); router.push(href); }

  function navigation() {
    return <nav aria-label="Documentation" className="docs-nav">
      {groups.map((group) => <details key={group} open>
        <summary>{group}<ChevronDown size={14} /></summary>
        <div>{pages.filter((page) => page.group === group).map((page) => <Link key={page.slug}
          href={docHref(page.slug)} aria-current={current?.slug === page.slug ? "page" : undefined}
          onClick={() => setMenuOpen(false)}>{page.title}</Link>)}</div>
      </details>)}
    </nav>;
  }

  const searchButton = <button className="docs-search-trigger" onClick={openSearch} aria-label="Search documentation">
    <Search size={17} /><span>Search docs</span><kbd>⌘ K</kbd>
  </button>;
  const bottom = <div className="docs-sidebar-bottom">
    <a href="https://github.com/chigozzdevv/termbook" aria-label="Termbook on GitHub" target="_blank" rel="noopener noreferrer"><CodeXml size={18} /></a>
    <Link href="/apps">Open app<ArrowUpRight size={13} /></Link>
    <button aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`} onClick={toggleTheme}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
  </div>;

  return <div className="docs-shell" data-theme={theme}>
    <a className="docs-skip" href="#docs-content">Skip to content</a>
    <aside className="docs-sidebar">
      <div className="docs-brand"><Logo /><Link href="/docs#docs-content" aria-label="Documentation home">Docs</Link></div>
      {searchButton}
      {navigation()}
      {bottom}
    </aside>
    <header className="docs-mobile-header">
      <button aria-label="Open documentation navigation" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
      <Logo /><button aria-label="Search documentation" onClick={openSearch}><Search size={20} /></button>
    </header>
    <div className="docs-body">
      {children}
      <aside className="docs-toc" aria-label="On this page">
        <span className="docs-toc-title"><List size={15} />On this page</span>
        <nav>{current?.sections.map((section) => <a key={section.id} href={`#${section.id}`}
          aria-current={active === section.id ? "location" : undefined}>{section.title}</a>)}</nav>
        <Link className="docs-back" href="/"><ArrowLeft size={14} />Back to Termbook</Link>
      </aside>
    </div>
    <dialog className="docs-menu-dialog" ref={menuDialog} onClose={() => setMenuOpen(false)} aria-labelledby="docs-menu-title">
      <div className="docs-menu-heading"><span id="docs-menu-title">Documentation</span><button onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={20} /></button></div>
      {searchButton}{navigation()}{bottom}
    </dialog>
    <dialog className="docs-search-dialog" ref={searchDialog} onClose={() => setSearchOpen(false)} aria-label="Search documentation"
      onClick={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
      <div className="docs-search-panel">
        <div className="docs-search-input">
          <Search size={20} />
          <input ref={searchInput} value={query} placeholder="Search documentation…" aria-label="Search query"
            role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="docs-search-results"
            aria-activedescendant={results[selected] ? `docs-result-${selected}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setSelected((index) => Math.max(0, Math.min(index + 1, results.length - 1))); }
              if (event.key === "ArrowUp") { event.preventDefault(); setSelected((index) => Math.max(index - 1, 0)); }
              if (event.key === "Enter" && results[selected]) { event.preventDefault(); selectResult(results[selected].href); }
            }} />
          <button onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={18} /></button>
        </div>
        <div id="docs-search-results" className="docs-search-results" ref={resultsList} role="listbox" aria-label="Search results">
          {results.length ? results.map((result, index) => <div key={result.href} id={`docs-result-${index}`} data-result={index}
            role="option" aria-selected={index === selected} onMouseEnter={() => setSelected(index)}>
            <button tabIndex={-1} onClick={() => selectResult(result.href)}>
              <span className="docs-result-group">{result.group}</span>
              <strong>{result.title}{result.heading && <span> / {result.heading}</span>}</strong>
              <span className="docs-result-excerpt">{result.text.slice(0, 145)}</span>
              <ArrowRight size={16} />
            </button>
          </div>) : <p className="docs-search-empty">No results for “{query}”. Try a capability, asset or operation.</p>}
        </div>
        <div className="docs-search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
        <span className="docs-sr-only" role="status">{results.length} results</span>
      </div>
    </dialog>
  </div>;
}
