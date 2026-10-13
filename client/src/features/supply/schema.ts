import { z } from "zod";

export const schema = z.object({
  asset: z.literal("USDC"),
  amount: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .pipe(
      z
        .string()
        .min(1, "Enter an amount.")
        .regex(/^\d{1,18}(?:\.\d{1,6})?$/, "Enter an amount with up to 6 decimal places."),
    )
    .refine((value) => /[1-9]/.test(value), "Enter an amount greater than zero."),
});

export type SupplyValues = z.infer<typeof schema>;
