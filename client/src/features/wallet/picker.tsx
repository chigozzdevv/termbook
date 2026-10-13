"use client";

import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useWallet } from "./use-wallet";

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

  return (
    <Dialog id={id} open={open} onClose={close} title="Connect wallet">
      <div className="mt-5 grid gap-3">
        {wallet.wallets.length ? (
          wallet.wallets.map((row) => (
            <Button
              variant="secondary"
              key={row.info.uuid}
              disabled={wallet.busy}
              onClick={async () => {
                const current = ++request.current;
                if ((await wallet.connect(row)) && current === request.current) {
                  onClose();
                  onConnected?.();
                }
              }}
            >
              {row.info.name}
            </Button>
          ))
        ) : (
          <p className="text-sm leading-[1.6] text-muted">
            No browser wallet found. Open this page in a browser with an EVM wallet installed.
          </p>
        )}
      </div>
      {wallet.error && (
        <p role="alert" className="mt-4 text-xs text-danger">
          {wallet.error}
        </p>
      )}
    </Dialog>
  );
}
