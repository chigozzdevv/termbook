import { z } from "zod";
import { addressSchema } from "./auth.js";

export const collateralSelectSchema = z.object({
  chainId: z.number().int().positive(),
  asset: addressSchema,
  amount: z.bigint().positive(),
  owner: addressSchema.optional(),
  recipient: addressSchema.optional(),
});

export type CollateralSelect = z.infer<typeof collateralSelectSchema>;
