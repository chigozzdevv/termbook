import { z } from "zod";

export const lpDepositSchema = z.object({
  amount: z.bigint().positive(),
  minShares: z.bigint().nonnegative(),
  deadline: z.number().int().positive(),
});

export type LpDeposit = z.infer<typeof lpDepositSchema>;
