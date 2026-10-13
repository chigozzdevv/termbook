import { Dialog as BaseDialog } from "@/components/ui/dialog";
import { short } from "@/lib/format";
import type { House } from "@/features/houses/types";
import { Form } from "./form";

export function Dialog({ house, onClose }: { house: House | null; onClose: () => void }) {
  return (
    <BaseDialog id="supply-dialog" open={house !== null} onClose={onClose} title="Supply">
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
