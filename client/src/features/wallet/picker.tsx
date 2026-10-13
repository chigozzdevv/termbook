"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, LoaderCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useWallet } from "./use-wallet";
import { brandFor, brands, imageSource } from "./branding";
import { WalletIcon } from "./icon";

export function Picker({
  id,
  open,
  onClose,
  onConnected,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onConnected?: () => void;
}) {
  const wallet = useWallet();
  const [connecting, setConnecting] = useState<string>();
  const missing = brands.filter(
    (brand) => !wallet.wallets.some((row) => brandFor(row.info)?.rdns === brand.rdns),
  );
  const request = useRef(0);
  const invalidate = useCallback(() => {
    request.current++;
  }, []);
  useEffect(
    () => () => {
      invalidate();
    },
    [invalidate],
  );
  const close = () => {
    invalidate();
    onClose();
  };
  useEffect(() => {
    if (open) window.dispatchEvent(new Event("eip6963:requestProvider"));
  }, [open]);

  return (
    <Dialog id={id} open={open} onClose={close} title="Connect wallet">
      <div className="mt-5 grid gap-2">
        {wallet.wallets.length > 0 ? (
          wallet.wallets.map((row) => (
            <button
              type="button"
              key={row.info.uuid}
              disabled={wallet.busy}
              aria-busy={wallet.busy && connecting === row.info.uuid}
              aria-label={`Connect ${row.info.name}`}
              className="touch-target flex w-full items-center gap-3 rounded-xl border border-line bg-background p-3 text-left transition-colors hover:border-accent/60 hover:bg-[#222527] disabled:cursor-wait disabled:opacity-60"
              onClick={async () => {
                const current = ++request.current;
                setConnecting(row.info.uuid);
                const connected = await wallet.connect(row);
                if (current !== request.current) return;
                setConnecting(undefined);
                if (connected) {
                  onClose();
                  onConnected?.();
                }
              }}
            >
              <WalletIcon src={imageSource(row.info.icon) ?? brandFor(row.info)?.icon} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.info.name}</span>
              {wallet.busy && connecting === row.info.uuid ? (
                <LoaderCircle
                  aria-label="Connecting"
                  size={18}
                  className="shrink-0 animate-spin text-accent"
                />
              ) : wallet.connection?.provider === row.provider ? (
                <Check aria-label="Connected" size={18} className="shrink-0 text-[#a6a6ff]" />
              ) : (
                <>
                  <span className="rounded-full bg-[#292c2f] px-2 py-1 text-[10px] text-muted">
                    Installed
                  </span>
                  <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-muted" />
                </>
              )}
            </button>
          ))
        ) : (
          <p className="mb-2 text-[13px] text-muted">No wallet detected in this browser.</p>
        )}
        {missing.length > 0 && (
          <>
            {wallet.wallets.length > 0 && (
              <p className="mt-3 mb-1 text-xs text-muted">More wallets</p>
            )}
            {missing.map((brand) => (
              <a
                key={brand.rdns}
                href={brand.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Get ${brand.name}`}
                className="touch-target flex items-center gap-3 rounded-xl border border-line bg-background p-3 transition-colors hover:border-[#53585b] hover:bg-[#222527]"
              >
                <WalletIcon src={brand.icon} />
                <span className="min-w-0 flex-1 text-sm font-medium">{brand.name}</span>
                <span className="text-xs text-muted">Get</span>
                <ArrowUpRight aria-hidden="true" size={16} className="text-muted" />
              </a>
            ))}
          </>
        )}
      </div>
      {wallet.error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-danger/10 p-3 text-xs leading-[1.6] text-danger"
        >
          {wallet.error}
        </p>
      )}
    </Dialog>
  );
}
