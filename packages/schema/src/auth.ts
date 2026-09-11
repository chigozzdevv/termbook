import { z } from "zod";

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const bigintSchema = z
  .union([z.bigint(), z.string().regex(/^\d+$/)])
  .transform((v) => BigInt(v));
