"use client";

import { useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { sendMessage } from "./api";
import type { ContactValues } from "./schema";

export function useSubmit() {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const submission = useRef<string | null>(null);
  const sending = useRef(false);

  function reset() {
    if (sending.current) return;
    submission.current = null;
    setStatus(null);
  }

  async function submit(values: ContactValues): Promise<boolean> {
    if (sending.current) return false;
    sending.current = true;
    setPending(true);
    setStatus(null);
    try {
      submission.current ??= crypto.randomUUID();
      await sendMessage(values, submission.current);
      submission.current = null;
      setStatus({ kind: "success", message: "Message sent. Thanks for reaching out." });
      return true;
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof ApiError && error.status === 429
            ? "Too many attempts. Please try again later."
            : "Couldn’t send your message. Please try again.",
      });
      return false;
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return { pending, status, reset, submit };
}
