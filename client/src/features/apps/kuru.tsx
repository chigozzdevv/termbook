import { Dialog } from "@/components/ui/dialog";

export function Kuru({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog id="kuru-dialog" open={open} onClose={onClose} title="Kuru">
      <p className="mb-6 text-[13px] leading-[1.6] text-muted">
        Spot trading on Monad. Buy and sell MON against USDC through your Credit Account.
      </p>
      <p className="mb-6 text-[13px] leading-[1.6] text-muted">
        The trading screen is coming soon.
      </p>
    </Dialog>
  );
}
