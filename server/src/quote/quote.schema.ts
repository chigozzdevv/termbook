import { z } from "zod";

export const quoteSchema = z.object({
  intentId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  borrower: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  house: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  sourceChain: z.number().int().positive().optional(),
  collateralVault: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  collateralAsset: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  collateralAmount: z.string().regex(/^\d+$/).optional(),
  returnRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  settlementAsset: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  limit: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  aprBps: z.number().int().nonnegative().max(1_000_000),
  originationFee: z.string().regex(/^\d+$/).default("0"),
  commitmentFeeBps: z.number().int().nonnegative().max(10_000).default(0),
  maturity: z.number().int().positive(),
  setupDeadline: z.number().int().positive(),
  grace: z.number().int().nonnegative(),
  reservationBond: z.string().regex(/^\d+$/).default("0"),
  nonce: z.string().regex(/^\d+$/),
  expiry: z.number().int().positive(),
  bundleId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  termsHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  revolving: z.boolean().default(false),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  domain: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
}).superRefine((value, ctx) => {
  if (BigInt(value.originationFee) > BigInt(value.limit)) ctx.addIssue({ code: "custom", path: ["originationFee"], message: "origination-fee-exceeds-limit" });
  if (value.setupDeadline >= value.maturity) ctx.addIssue({ code: "custom", path: ["setupDeadline"], message: "setup-before-maturity-required" });
  if (value.expiry > value.setupDeadline) ctx.addIssue({ code: "custom", path: ["expiry"], message: "quote-expiry-before-setup-deadline-required" });
  const full = [value.owner, value.sourceChain, value.collateralVault, value.collateralAsset, value.collateralAmount, value.returnRecipient, value.settlementAsset].every((item) => item !== undefined);
  const partial = [value.owner, value.sourceChain, value.collateralVault, value.collateralAsset, value.collateralAmount, value.returnRecipient, value.settlementAsset].some((item) => item !== undefined);
  if (partial && !full) ctx.addIssue({ code: "custom", path: ["collateralVault"], message: "complete-collateral-binding-required" });
});
