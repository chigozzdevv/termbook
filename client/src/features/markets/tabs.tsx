"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { houses } from "@/features/houses/mock";
import { orders } from "@/features/orders/mock";
import type { View } from "./explorer";

export function Tabs({ view }: { view: View }) {
  const router = useRouter();
  const focusOnChange = useRef(false);
  const selected = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (focusOnChange.current) selected.current?.focus();
    focusOnChange.current = false;
  }, [view]);

  function change(view: View) {
    router.replace(view === "houses" ? "/?view=houses" : "/", { scroll: false });
  }

  return (
    <div role="tablist" aria-label="Browse Termbook" className="mb-[14px] flex items-center gap-7">
      {(["orders", "houses"] as const).map((tab) => (
        <button
          key={tab}
          ref={view === tab ? selected : undefined}
          type="button"
          id={`${tab}-tab`}
          role="tab"
          aria-selected={view === tab}
          aria-controls="records"
          tabIndex={view === tab ? 0 : -1}
          onClick={() => change(tab)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "orders"
                : event.key === "End"
                  ? "houses"
                  : tab === "orders"
                    ? "houses"
                    : "orders";
            focusOnChange.current = next !== view;
            change(next);
          }}
          className={`flex items-center gap-2 border-0 bg-transparent pt-[13px] pb-4 text-[17px] ${view === tab ? "text-foreground" : "text-muted"}`}
        >
          {tab === "orders" ? "Orders" : "Houses"}
          <span className="rounded-[5px] bg-[#25272a] px-[5px] py-[2px] font-mono text-[11px] text-muted">
            {tab === "orders" ? orders.length : houses.length}
          </span>
        </button>
      ))}
    </div>
  );
}
