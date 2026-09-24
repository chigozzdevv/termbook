import { z } from "zod";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/)
  .transform((value): `0x${string}` => value.toLowerCase() as `0x${string}`);

export const solanaActionPlanSchema = z.object({
  creditId: word,
  kind: z.enum(["release", "seize"]),
  mode: z.enum(["apply", "expire"]),
  authorizationTxHash: word,
}).strict();

export const solanaConfirmationPlanSchema = z.object({
  creditId: word,
  kind: z.enum(["release", "seize"]),
  mode: z.enum(["apply", "expire"]),
  sourceTx: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{85,88}$/).optional(),
}).strict();
