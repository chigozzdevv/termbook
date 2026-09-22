import { z } from "zod";

export const collateralSchema = z.object({
  lockId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  creditId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  amount: z.string().min(1),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
}).strict();
