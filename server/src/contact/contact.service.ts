import { z } from "zod";
import { HttpError } from "../http/http.errors.js";
import type { ContactInput } from "./contact.schema.js";

const recipient = "termbook@muwa.io";

export async function sendContact(input: ContactInput): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"]?.trim();
  const from = process.env["CONTACT_FROM_EMAIL"]?.trim() || "Termbook <termbook@muwa.io>";
  const sender = from.match(/<([^<>]+)>$/)?.[1] ?? from;
  if (!apiKey || /[\r\n]/.test(from) || !z.string().email().safeParse(sender).success) {
    throw new HttpError(503, "contact-unavailable");
  }
  const text = [
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Reason: ${input.reason}`,
    `Project or website: ${input.project || "Not provided"}`,
    "", "Message:", input.message,
  ].join("\n");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `contact/${input.submission_id}`,
      },
      body: JSON.stringify({ from, to: [recipient], reply_to: input.email,
        subject: `Termbook enquiry: ${input.reason}`, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new HttpError(502, "contact-send-failed");
    const result: unknown = await response.json();
    if (!z.object({ id: z.string().min(1) }).safeParse(result).success) {
      throw new HttpError(502, "contact-send-failed");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "contact-unavailable");
  }
}
