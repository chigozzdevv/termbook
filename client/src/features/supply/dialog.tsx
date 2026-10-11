import { Dialog as BaseDialog } from "@/components/ui/dialog";
import { short } from "@/lib/format";
import type { House } from "@/features/houses/types";
import { Form } from "./form";

export function Dialog({ house, onClose }: { house: House | null; onClose: () => void }) {
  return (
    <BaseDialog
      id="supply-dialog"
      open={house !== null}
      onClose={onClose}
      title="Supply"
      badge={
        <span className="rounded-2xl border border-[#4a405e] bg-[#242031] px-[10px] py-[5px] text-[11px] whitespace-nowrap text-[#c1b5e7]">
          Mock data
        </span>
      }
    >
      {house && (
        <>
          <p className="mb-[22px] font-mono text-xs text-muted">
            House {short(house.house)} · Lends USDC on Monad
          </p>
          <Form key={house.house} house={house} onClose={onClose} />
        </>
      )}
    </BaseDialog>
  );
}
