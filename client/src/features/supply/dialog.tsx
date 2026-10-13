import { Dialog as BaseDialog } from "@/components/ui/dialog";
import { short } from "@/lib/format";
import Link from "next/link";
import type { House } from "@/features/houses/types";
import { Form } from "./form";

export function Dialog({ house, onClose }: { house: House | null; onClose: () => void }) {
  return (
    <BaseDialog
      id="supply-dialog"
      open={house !== null}
      onClose={onClose}
      title="Supply liquidity"
      className="supply-dialog"
    >
      {house && (
        <>
          <p className="mb-6 text-xs text-muted">
            House{" "}
            <Link
              href={`/houses/${house.house}`}
              onClick={onClose}
              className="font-mono text-foreground hover:text-accent"
            >
              {short(house.house)}
            </Link>
          </p>
          <Form key={house.house} house={house} onClose={onClose} />
        </>
      )}
    </BaseDialog>
  );
}
