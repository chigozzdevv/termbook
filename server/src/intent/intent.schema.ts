import { z } from "zod";

export const intentSchema = z.object({
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  duration: z.number().int().positive().max(365 * 86400),
  limit: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n).optional(),
  action: z.object({
    capability: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
    target: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    data: z.string().regex(/^0x[0-9a-fA-F]*$/).optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (!value.action && !value.limit) ctx.addIssue({ code: "custom", path: ["limit"], message: "limit-required-without-action" });
});
