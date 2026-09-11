import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const lockSchema = z.object({
  lockId: bytes32Schema,
  creditId: bytes32Schema,
  owner: addressSchema,
  amount: z.bigint().positive(),
  recipient: addressSchema,
});

export type Lock = z.infer<typeof lockSchema>;
