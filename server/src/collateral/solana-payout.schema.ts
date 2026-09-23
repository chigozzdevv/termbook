import { z } from "zod";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/)
  .transform((value): `0x${string}` => value.toLowerCase() as `0x${string}`);

export const solanaRecoveryPayoutPlanSchema = z.object({
  creditId: word,
  authorizationTxHash: word,
}).strict();
