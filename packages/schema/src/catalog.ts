import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const catalogQuerySchema = z.object({
  chainId: z.number().int().positive().optional(),
  asset: z.string().optional(),
  house: z.string().optional(),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

const marketBase = { id: z.string().regex(/^[a-z0-9_-]{1,64}$/), label: z.string().min(1).max(80),
  decimals: z.number().int().min(0).max(18), chainId: z.number().int().positive(),
  rpcUrl: z.url() };

export const collateralMarketSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...marketBase, kind: z.literal("evm"), asset: addressSchema, vault: addressSchema,
    controller: addressSchema, nativeVault: z.boolean().default(false) }),
  z.strictObject({ ...marketBase, kind: z.literal("solana"), genesis: bytes32Schema,
    asset: bytes32Schema, program: bytes32Schema,
    testnetUpgradeAuthority: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional() }),
]);

export type CollateralMarket = z.infer<typeof collateralMarketSchema>;
