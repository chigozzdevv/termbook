import { z } from "zod";

export const reasons = [
  "App integration",
  "Supplying liquidity",
  "Borrowing",
  "Partnership",
  "Something else",
] as const;

export const schema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: z.string().trim().email("Enter a valid email address.").max(254),
  reason: z.enum(reasons, { error: "Choose a reason." }),
  project: z.string().trim().max(200),
  message: z.string().trim().min(1, "Enter a message.").max(1200),
});

export type ContactValues = z.infer<typeof schema>;
