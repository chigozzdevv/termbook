"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, X } from "lucide-react";
import { Code } from "./code";
import { useDocsTheme } from "./theme";

let renderQueue = Promise.resolve();

function renderDiagram(id: string, source: string, theme: "light" | "dark") {
  const result = renderQueue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    await document.fonts.ready;
    const dark = theme === "dark";
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      fontFamily: getComputedStyle(document.body).fontFamily,
      themeVariables: {
        darkMode: dark,
        fontSize: "14px",
        primaryColor: dark ? "#242433" : "#ededff",
        primaryTextColor: dark ? "#eae9e4" : "#22242a",
        primaryBorderColor: dark ? "#7b7bcb" : "#6969d4",
        secondaryColor: dark ? "#181a1b" : "#f1f1ef",
        tertiaryColor: dark ? "#151718" : "#f7f7f4",
        lineColor: dark ? "#93999d" : "#666a74",
        textColor: dark ? "#eae9e4" : "#22242a",
        clusterBkg: dark ? "#151718" : "#f7f7f4",
        clusterBorder: dark ? "#3b3e44" : "#d4d4db",
        edgeLabelBackground: dark ? "#101213" : "#fafaf8",
        actorBkg: dark ? "#242433" : "#ededff",
        actorBorder: dark ? "#7b7bcb" : "#6969d4",
        actorTextColor: dark ? "#eae9e4" : "#22242a",
        actorLineColor: dark ? "#60646c" : "#babcc5",
        signalColor: dark ? "#93999d" : "#666a74",
        signalTextColor: dark ? "#eae9e4" : "#22242a",
        noteBkgColor: dark ? "#181a1b" : "#f1f1ef",
        noteBorderColor: dark ? "#3b3e44" : "#d4d4db",
        noteTextColor: dark ? "#eae9e4" : "#22242a",
      },
      flowchart: { htmlLabels: false, useMaxWidth: false, curve: "linear", nodeSpacing: 28, rankSpacing: 42, padding: 14 },
      sequence: { useMaxWidth: false, wrap: true, width: 130, height: 46, actorMargin: 40, messageMargin: 36, mirrorActors: false },
    });
    return mermaid.render(id, source);
  });
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function Diagram({ title, description, source }: { title: string; description: string; source: string }) {
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const theme = useDocsTheme();
  const [result, setResult] = useState<{ theme: string; source: string; svg?: string; error?: boolean }>();
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = result?.theme === theme && result.source === source ? result : undefined;

  useEffect(() => {
    let cancelled = false;
    const [type, ...lines] = source.split("\n");
    const accessible = [type, `accTitle: ${title}`, `accDescr: ${description}`, ...lines].join("\n");
    renderDiagram(id, accessible, theme).then(({ svg }) => {
      if (!cancelled) setResult({ theme, source, svg });
    }).catch(() => {
      if (!cancelled) setResult({ theme, source, error: true });
    });
    return () => { cancelled = true; };
  }, [id, title, description, source, theme]);

  return <figure className="docs-diagram">
    <figcaption><span>{title}</span><button type="button" disabled={!current?.svg} aria-label={`Expand ${title} diagram`}
      onClick={() => { setExpanded(true); dialog.current?.showModal(); }}>Expand<ArrowUpRight size={14} aria-hidden="true" /></button></figcaption>
    {current?.svg && !expanded ? <div className={`docs-diagram-scroll${source.startsWith("flowchart TD") ? " docs-diagram-vertical" : ""}`} role="region" aria-label={`${title} diagram`} tabIndex={0}
      dangerouslySetInnerHTML={{ __html: current.svg }} />
      : <p className="docs-diagram-status" role="status">{expanded ? "Diagram expanded." : current?.error ? "Diagram unavailable. View its Mermaid source below." : "Loading diagram…"}</p>}
    <p className="docs-diagram-description">{description}</p>
    <details className="docs-diagram-source">
      <summary>Mermaid source<ChevronDown size={14} aria-hidden="true" /></summary>
      <Code language="mermaid" title={`${title} · Mermaid`} value={source} />
    </details>
    <dialog ref={dialog} className="docs-diagram-dialog" aria-labelledby={`${id}-expanded-title`} onClose={() => setExpanded(false)}>
      <header><strong id={`${id}-expanded-title`}>{title}</strong>
        <button type="button" aria-label="Close expanded diagram" onClick={() => dialog.current?.close()}><X size={18} /></button>
      </header>
      {expanded && current?.svg && <div className="docs-diagram-scroll" role="region" aria-label={`${title} expanded diagram`} tabIndex={0}
        dangerouslySetInnerHTML={{ __html: current.svg }} />}
      <p>{description}</p>
    </dialog>
  </figure>;
}
