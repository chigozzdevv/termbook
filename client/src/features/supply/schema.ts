import { z } from "zod";

export const schema = z.object({
  asset: z.enum(["USDC", "WETH"]),
  amount: z.coerce.number().positive("Enter a valid amount."),
});

export type SupplyValues = z.infer<typeof schema>;
