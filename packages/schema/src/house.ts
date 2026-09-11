import { z } from "zod";
import { addressSchema } from "./auth.js";

export const houseSchema = z.object({
  id: addressSchema,
  vault: addressSchema,
  asset: addressSchema,
  manager: addressSchema,
  active: z.boolean(),
});

export type House = z.infer<typeof houseSchema>;
