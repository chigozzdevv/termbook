import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const capabilitySchema = z.enum([
  "place_order",
  "increase_position",
  "decrease_position",
  "add_margin",
  "remove_margin",
  "cancel_order",
  "close_position",
  "stake",
  "claim_rewards",
  "deposit_vault",
  "redeem_vault",
  "swap_exact_in",
  "supply",
  "borrow",
  "repay",
  "flash_loan",
]);

export const actionSchema = z.object({
  capability: capabilitySchema,
  params: z.record(z.string(), z.unknown()),
  target: addressSchema.optional(),
  data: z.string().regex(/^0x[0-9a-fA-F]*$/).optional(),
});

export const bundleSchema = z.object({
  id: bytes32Schema,
  primary: bytes32Schema,
  deps: z.array(bytes32Schema),
});

export type TermAction = z.infer<typeof actionSchema>;
