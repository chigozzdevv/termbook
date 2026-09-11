import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const quoteSchema = z.object({
  id: z.string().min(1),
  borrower: addressSchema,
  owner: addressSchema.optional(),
  house: addressSchema,
  vault: addressSchema,
  sourceChain: z.number().int().positive().optional(),
  collateralVault: addressSchema.optional(),
  collateralAsset: addressSchema.optional(),
  collateralAmount: z.bigint().positive().optional(),
  returnRecipient: addressSchema.optional(),
  settlementAsset: addressSchema.optional(),
  intentId: bytes32Schema.optional(),
  limit: z.bigint().positive(),
  maturity: z.number().int().positive(),
  setupDeadline: z.number().int().positive().optional(),
  grace: z.number().int().nonnegative().optional(),
  reservationBond: z.bigint().nonnegative().optional(),
  nonce: z.bigint().nonnegative().optional(),
  expiry: z.number().int().positive(),
  bundleId: bytes32Schema,
  termsHash: bytes32Schema,
  aprBps: z.number().int().nonnegative(),
  originationFee: z.bigint().nonnegative().optional(),
  commitmentFeeBps: z.number().int().nonnegative().optional(),
  revolving: z.boolean().optional(),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/).optional(),
});

export type Quote = z.infer<typeof quoteSchema>;
