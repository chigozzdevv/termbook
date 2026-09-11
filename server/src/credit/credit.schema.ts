import { z } from "zod";

export const creditSchema = z.object({
  creditId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  house: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
