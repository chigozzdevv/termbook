import { Dialog as BaseDialog } from "@/components/ui/dialog";
import { Form } from "./form";
import type { ContactValues } from "./schema";

export function Dialog({
  open,
  onClose,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  reason?: ContactValues["reason"];
}) {
  return (
    <BaseDialog
      id="contact-dialog"
      open={open}
      onClose={onClose}
      title="Let’s talk"
      closeLabel="Close contact form"
      className="max-h-[min(620px,calc(100dvh-32px))] max-w-[540px] max-[430px]:max-h-[min(500px,calc(100dvh-32px))] max-[430px]:p-5"
    >
      <p className="mb-6 text-[13px] leading-[1.6] text-muted">Tell us what you have in mind.</p>
      <Form key={reason ?? "general"} reason={reason} />
    </BaseDialog>
  );
}
