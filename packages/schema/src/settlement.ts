import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const operationSchema = z.object({
  operationId: bytes32Schema,
  kind: z.enum(["repay", "recovery", "lp_deposit"]),
  sourceChain: z.number().int().positive(),
  sourceAsset: addressSchema,
  maxAmountIn: z.bigint().positive(),
  vault: addressSchema,
  creditId: bytes32Schema.optional(),
  minAmountOut: z.bigint(),
  deadline: z.number().int().positive(),
  refundRecipient: addressSchema,
  sourceRefundRecipient: addressSchema.optional(),
  monadRefundRecipient: addressSchema.optional(),
  routeVersion: bytes32Schema.optional(),
  servicingVersion: bytes32Schema.optional(),
});

export type Operation = z.infer<typeof operationSchema>;
