"use client";

import { useState } from "react";
import { Check, Copy, ChevronDown, ChevronUp } from "lucide-react";

function highlight(value: string, language: string) {
  if (!["typescript", "json"].includes(language)) return value;
  const pattern = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:import|from|export|type|interface|const|let|async|await|return|if|else|throw|new|function|class|extends|readonly|as|try|catch|typeof|instanceof)\b|\b(?:true|false|null|undefined)\b|\b\d[\d_]*(?:\.\d+)?n?\b)/g;
  return value.split(pattern).map((token, index) => {
    const kind = /^\/\//.test(token) || /^\/\*/.test(token) ? "comment"
      : /^["'`]/.test(token) ? "string"
      : /^(true|false|null|undefined|\d)/.test(token) ? "literal"
      : /^(import|from|export|type|interface|const|let|async|await|return|if|else|throw|new|function|class|extends|readonly|as|try|catch|typeof|instanceof)$/.test(token) ? "keyword" : "";
    return kind ? <span key={index} className={`syntax-${kind}`}>{token}</span> : token;
  });
}

export function Code({ title, value, language }: { title: string; value: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const long = value.split("\n").length > 32;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="docs-code">
      <div className="docs-code-header">
        <span>{title}</span>
        <button onClick={() => void copy()} aria-label={copied ? "Code copied" : `Copy ${title}`}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <pre className={long && !expanded ? "docs-code-collapsed" : undefined} tabIndex={0} aria-label={title}>
        <code>{highlight(value, language)}</code>
      </pre>
      <span className="docs-sr-only" role="status">{copied ? "Code copied" : failed ? "Copy failed. Select and copy the code." : ""}</span>
      {long && <button className="docs-code-expand" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? "Collapse code" : "Show full code"}
      </button>}
    </div>
  );
}
