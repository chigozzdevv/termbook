"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { short } from "@/lib/format";

export function Account({
  address,
  disabled,
  onDisconnect,
  onAccount,
  addressClassName = "",
}: {
  address: string;
  disabled?: boolean;
  onDisconnect: () => void;
  onAccount?: () => void;
  addressClassName?: string;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    menu.current?.hidePopover();
  }, [address, disabled]);

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
    <>
      <Button
        variant="secondary"
        disabled={disabled}
        title={address}
        aria-label={`Wallet ${address}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(12, Math.min(rect.right - 192, window.innerWidth - 204)),
            top: rect.bottom + 8,
          });
        }}
      >
        <Wallet size={14} aria-hidden="true" />
        <span className={`font-mono text-xs ${addressClassName}`}>{short(address)}</span>
      </Button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="Wallet actions"
        className="fixed right-auto bottom-auto m-0 w-48 rounded-xl border border-line bg-panel p-1.5 text-foreground shadow-xl"
        style={position}
        onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}
      >
        {onAccount && (
          <button
            type="button"
            className="touch-target flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] hover:bg-[#27292b]"
            onClick={() => {
              menu.current?.hidePopover();
              onAccount();
            }}
          >
            <Wallet size={14} aria-hidden="true" />
            Credit account
          </button>
        )}
        <button
          type="button"
          className="touch-target flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] hover:bg-[#27292b]"
          onClick={() => {
            menu.current?.hidePopover();
            onDisconnect();
          }}
        >
          <LogOut size={14} aria-hidden="true" />
          Disconnect
        </button>
      </div>
    </>
  );
}
