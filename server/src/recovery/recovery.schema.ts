import { z } from "zod";

export const recoverySchema = z.object({
  creditId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  kind: z.enum(["partial", "full"]),
});
