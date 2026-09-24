import { z } from "zod";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/)
  .transform((value): `0x${string}` => value.toLowerCase() as `0x${string}`);

export const solanaRecoveryFundingPlanSchema = z.object({
  creditId: word,
  operationId: word,
  authorizationTxHash: word,
}).strict();

export const solanaRecoveryFundingConfirmationSchema = z.object({
  creditId: word,
  operationId: word,
  mode: z.enum(["confirm", "cancel"]),
  sourceTx: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{85,88}$/).optional(),
}).strict();

export const solanaRecoveryPayoutConfirmationSchema = z.object({
  creditId: word,
  mode: z.enum(["confirm", "cancel"]),
  sourceTx: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{85,88}$/).optional(),
}).strict();

export const solanaRecoveryRefundReconciliationSchema = z.object({
  creditId: word,
  cumulativeRefunded: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  sourceTx: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{85,88}$/).optional(),
}).strict();
