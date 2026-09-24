import { z } from "zod";
import { solanaIntentCollateralSchema } from "@termbook/schema";

const actionSchema = z.strictObject({
  capability: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  params: z.record(z.string(), z.unknown()),
});

const evmIntentSchema = z.strictObject({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  duration: z.number().int().positive().max(365 * 86400),
  limit: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n).optional(),
  action: actionSchema.optional(),
}).superRefine((value, ctx) => {
  if (!value.action && !value.limit) ctx.addIssue({ code: "custom", path: ["limit"], message: "limit-required-without-action" });
});

const solanaIntentSchema = z.strictObject({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  collateral: solanaIntentCollateralSchema,
  duration: z.number().int().positive().max(365 * 86400),
  limit: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n).optional(),
  action: actionSchema.optional(),
}).superRefine((value, ctx) => {
  if (!value.action && !value.limit) ctx.addIssue({ code: "custom", path: ["limit"], message: "limit-required-without-action" });
});

export const intentSchema = z.union([evmIntentSchema, solanaIntentSchema]);
