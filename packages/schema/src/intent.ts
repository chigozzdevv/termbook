import { z } from "zod";
import { addressSchema } from "./auth.js";
import { collateralSelectionSchema } from "./collateral-setup.js";

export const collateralSelectSchema = z.object({
  chainId: z.number().int().positive(),
  asset: addressSchema,
  amount: z.bigint().positive(),
  owner: addressSchema.optional(),
  recipient: addressSchema.optional(),
});

export type CollateralSelect = z.infer<typeof collateralSelectSchema>;

export const solanaIntentCollateralSchema = z.object({
  chain: z.object({ namespace: z.literal("solana"), reference: z.string() }),
  asset: z.object({ namespace: z.literal("solana"), reference: z.string(), kind: z.literal("native"), assetBytes: z.string() }),
  owner: z.object({ namespace: z.literal("solana"), reference: z.string(), accountBytes: z.string() }),
  returnRecipient: z.object({ namespace: z.literal("solana"), reference: z.string(), accountBytes: z.string() }),
  amount: z.string().regex(/^[1-9][0-9]*$/),
}).superRefine((value, ctx) => {
  const parsed = collateralSelectionSchema.safeParse({ ...value, amount: BigInt(value.amount) });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});
