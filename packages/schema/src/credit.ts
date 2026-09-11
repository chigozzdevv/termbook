import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const facilitySchema = z.enum([
  "reserved",
  "collateral_locking",
  "collateral_proving",
  "account_creating",
  "ready",
  "closing",
  "closed",
  "aborted",
  "liquidating",
  "recovery_pending",
  "liquidated",
]);

export const creditSchema = z.object({
  id: bytes32Schema,
  borrower: addressSchema,
  house: addressSchema,
  vault: addressSchema,
  account: addressSchema.nullable(),
  limit: z.bigint(),
  debt: z.bigint(),
  facility: facilitySchema,
  revision: z.bigint(),
});

export type Credit = z.infer<typeof creditSchema>;
