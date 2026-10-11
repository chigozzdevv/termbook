"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  id: string;
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel?: string;
  className?: string;
  badge?: ReactNode;
  children: ReactNode;
}

export function Dialog({
  id,
  open,
  onClose,
  title,
  closeLabel,
  className = "",
  badge,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      id={id}
      onClose={onClose}
      aria-labelledby={`${id}-title`}
      className={`m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[420px] overflow-y-auto overscroll-contain rounded-2xl border border-[#3c3d45] bg-panel p-6 text-foreground ${className}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="m-0 font-heading text-[28px] leading-[1.15]">
          {title}
        </h2>
        {badge ?? (
          <button
            type="button"
            aria-label={closeLabel ?? `Close ${title}`}
            onClick={onClose}
            className="touch-target grid size-8 shrink-0 place-items-center rounded-md text-[#a4aaad] hover:bg-[#27292b] hover:text-[#f4f4ef]"
          >
            <X aria-hidden="true" size={18} />
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
