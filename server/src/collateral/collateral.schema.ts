import { z } from "zod";

export const collateralSchema = z.object({
  lockId: z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase()),
  creditId: z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase()),
  amount: z.string().regex(/^[1-9][0-9]{0,77}$/),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((value) => value.toLowerCase()),
}).strict();
