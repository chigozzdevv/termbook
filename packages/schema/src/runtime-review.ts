import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const runtimeReviewSchema = z.strictObject({
  chain_id: z.literal(10143), core: addressSchema, target: addressSchema, implementation: addressSchema,
  code_hash: bytes32Schema, abi: z.array(z.string().startsWith("function ").max(512)).min(1).max(16),
  maximum_input: z.string().regex(/^[1-9]\d{0,5}$/).refine((v) => BigInt(v) <= 100_000n),
  approved_at: z.number().int().positive(), expires_at: z.number().int().positive(),
  reviewer: addressSchema, signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
}).refine((v) => v.expires_at > v.approved_at && v.expires_at - v.approved_at <= 7 * 86400
  && ![v.core, v.target, v.implementation, v.reviewer].some((a) => /^0x0{40}$/i.test(a))
  && !/^0x0{64}$/i.test(v.code_hash), "integration-runtime-review-invalid");
export type RuntimeReview = z.infer<typeof runtimeReviewSchema>;
export const runtimeReviewSummarySchema = z.strictObject({
  id: bytes32Schema, expires_at: z.number().int().positive(), maximum_input: z.string().regex(/^[1-9]\d{0,5}$/),
});
