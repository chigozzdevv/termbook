import { z } from "zod";

export const liquiditySchema = z.object({
  house: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  depositor: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().min(1),
});
