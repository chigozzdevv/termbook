import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

const units = z.string().regex(/^\d+$/);
const precision = z.number().int().min(0).max(36);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const explorerHouseSchema = z.object({
  house: addressSchema, vault: addressSchema, manager: addressSchema, asset: addressSchema,
  active: z.boolean(), paused: z.boolean(), depositsOpen: z.boolean(),
  unresolvedCreditImpairment: units, freeCash: units, queuedWithdrawalAssets: units,
  committedCash: units, drawnPrincipal: units, availableCash: units,
  totalAssets: units, totalShares: units, sharePrice: units, assetSymbol: z.string().min(1).max(80), decimals: precision,
});
export const explorerOrderSchema = z.object({
  id: bytes32Schema, intentId: bytes32Schema, kind: z.enum(["request", "credit"]), creditId: bytes32Schema.nullable(),
  borrower: addressSchema, house: addressSchema.nullable(), settlementAsset: addressSchema,
  settlementSymbol: z.string().min(1).max(80), settlementDecimals: precision,
  limit: units, debt: units.nullable(), aprBps: integer.nullable(), maturity: integer.nullable(),
  facility: z.string().nullable(), status: z.string(),
  collateral: z.object({ symbol: z.string().min(1).max(80), amount: units, decimals: precision, asset: z.string(),
    chain: z.object({ label: z.string(), chainId: integer.optional(), namespace: z.enum(["eip155", "solana"]), reference: z.string().optional() }),
  }),
  duration: integer, createdAt: z.iso.datetime(), expiresAt: integer.nullable(),
  events: z.array(z.object({ event: z.string(), blockNumber: integer,
    transactionHash: bytes32Schema, logIndex: integer, args: z.object({ creditId: bytes32Schema }) })),
});
export const explorerPageSchema = z.object({
  records: z.array(explorerOrderSchema).max(50), total: integer, next: bytes32Schema.nullable(), block: units,
});
export type ExplorerHouse = z.infer<typeof explorerHouseSchema>;
export type ExplorerOrder = z.infer<typeof explorerOrderSchema>;
