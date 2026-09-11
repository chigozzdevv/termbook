import { z } from "zod";

export const houseSchema = z.object({
  house: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  manager: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});
