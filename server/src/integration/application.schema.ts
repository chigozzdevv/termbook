import { z } from "zod";

export const applicationSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  origin: z.url().max(255),
  chainId: z.number().int().positive(),
});

export const applicationIdSchema = z.uuid();
