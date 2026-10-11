"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  }

  const Icon = state === "copied" ? Check : Copy;
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={state === "copied" ? `Copied ${label}` : `Copy ${label}`}
        title={state === "copied" ? "Copied" : `Copy ${label}`}
        className={`touch-target inline-grid size-6 shrink-0 place-items-center rounded-sm hover:bg-[#2b2e30] hover:text-foreground ${state === "copied" ? "text-success" : "text-muted"}`}
      >
        <Icon aria-hidden="true" size={13} strokeWidth={1.8} />
      </button>
      <span className="sr-only" role="status">
        {state === "copied"
          ? `Copied ${label}.`
          : state === "failed"
            ? `Could not copy ${label}.`
            : ""}
      </span>
    </>
  );
}
