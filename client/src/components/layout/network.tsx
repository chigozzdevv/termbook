"use client";

import { Check, Globe } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function Network() {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!open) return;
    const close = () => menu.current?.hidePopover();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div className="network-switch">
      <button
        type="button"
        className="network-trigger"
        aria-label="Network: Monad testnet"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        title="Monad testnet"
        popoverTarget={id}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(12, Math.min(rect.left + rect.width / 2 - 104, window.innerWidth - 220)),
            top: rect.bottom + 8,
          });
        }}
      >
        <Globe size={18} className="network-icon" aria-hidden="true" />
        <span className="network-name">Monad testnet</span>
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="Networks"
        className="network-menu"
        style={position}
        onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}
      >
        <button
          type="button"
          className="network-option"
          aria-pressed="true"
          onClick={() => menu.current?.hidePopover()}
        >
          Monad testnet <Check size={14} aria-hidden="true" />
        </button>
        <button type="button" className="network-option" disabled>
          Monad mainnet
        </button>
      </div>
    </div>
  );
}
