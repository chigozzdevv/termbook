import { z } from "zod";
import { api } from "@/lib/api";
import type { ContactValues } from "./schema";

export async function sendMessage(values: ContactValues, submissionId: string): Promise<void> {
  const result = await api("/contact", {
    method: "POST",
    body: JSON.stringify({ ...values, submission_id: submissionId }),
  });
  z.object({ ok: z.literal(true) }).parse(result);
}
