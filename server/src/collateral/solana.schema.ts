import { z } from "zod";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/)
  .refine((value) => !/^0x0{64}$/i.test(value))
  .transform((value): `0x${string}` => value.toLowerCase() as `0x${string}`);

export const solanaTrackSchema = z.object({
  creditId: word,
  lockId: word,
  lockPda: word,
}).strict();
