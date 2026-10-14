import { z } from "zod";

export const contactSchema = z.object({
  submission_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  reason: z.enum(["App integration", "Supplying liquidity", "Borrowing", "Partnership", "Something else"]),
  project: z.string().trim().max(200).optional().default(""),
  message: z.string().trim().min(1).max(1200),
}).strict();

export type ContactInput = z.infer<typeof contactSchema>;
