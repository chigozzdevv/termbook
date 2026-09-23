import { z } from "zod";

export const settlementSchema = z.object({
  operationId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  kind: z.enum(["repay", "recovery", "lp_deposit"]),
  payer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  nonce: z.string().regex(/^\d+$/).refine((value) => BigInt(value) >= 0n),
  sourceChain: z.number().int().positive(),
  sourceAsset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  creditId: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  maxAmountIn: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  maxReceived: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  minAmountOut: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  deadline: z.number().int().positive(),
  refundRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  sourceRefundRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  monadRefundRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  routeId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  routeVersion: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  lpRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  minShares: z.string().regex(/^\d+$/).optional(),
}).superRefine((value, ctx) => {
  if (value.kind !== "lp_deposit" && !value.creditId) ctx.addIssue({ code: "custom", path: ["creditId"], message: "credit-required" });
  if (value.kind === "lp_deposit" && value.creditId) ctx.addIssue({ code: "custom", path: ["creditId"], message: "credit-not-allowed" });
  if (value.kind === "lp_deposit" && (!value.lpRecipient || !value.minShares || BigInt(value.minShares) === 0n)) ctx.addIssue({ code: "custom", path: ["lpRecipient"], message: "lp-terms-required" });
  if (value.kind !== "lp_deposit" && (value.lpRecipient || value.minShares)) ctx.addIssue({ code: "custom", path: ["lpRecipient"], message: "lp-terms-not-allowed" });
  if (BigInt(value.minAmountOut) > BigInt(value.maxReceived)) ctx.addIssue({ code: "custom", path: ["maxReceived"], message: "receipt-cap-too-low" });
  if (value.refundRecipient.toLowerCase() !== value.monadRefundRecipient.toLowerCase()) ctx.addIssue({ code: "custom", path: ["monadRefundRecipient"], message: "refund-recipient-mismatch" });
  if (value.deadline <= Math.floor(Date.now() / 1000)) ctx.addIssue({ code: "custom", path: ["deadline"], message: "expired" });
});
