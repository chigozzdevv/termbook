import { z } from "zod";

export const catalogQuerySchema = z.object({
  chainId: z.number().int().positive().optional(),
  asset: z.string().optional(),
  house: z.string().optional(),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
