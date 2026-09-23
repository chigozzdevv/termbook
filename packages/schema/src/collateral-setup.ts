import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

const evmAddressSchema = addressSchema.transform((value): `0x${string}` => value as `0x${string}`);
const hashSchema = bytes32Schema.transform((value): `0x${string}` => value as `0x${string}`);
const solanaKeySchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/).refine((value) => !/^0x0{64}$/i.test(value)).transform((value): `0x${string}` => value.toLowerCase() as `0x${string}`);
export const NATIVE_SOL_ASSET_BYTES = `0x${"01".repeat(32)}` as const;
export const collateralChainSchema = z.discriminatedUnion("namespace", [
  z.object({ namespace: z.literal("eip155"), reference: z.string().regex(/^[1-9][0-9]*$/) }),
  z.object({ namespace: z.literal("solana"), reference: solanaKeySchema }),
]);

export const collateralAccountSchema = z.discriminatedUnion("namespace", [
  z.object({ namespace: z.literal("eip155"), reference: z.string().regex(/^[1-9][0-9]*$/), accountBytes: evmAddressSchema }),
  z.object({ namespace: z.literal("solana"), reference: solanaKeySchema, accountBytes: solanaKeySchema }),
]);

const collateralAssetBaseSchema = z.discriminatedUnion("namespace", [
  z.object({ namespace: z.literal("eip155"), reference: z.string().regex(/^[1-9][0-9]*$/), kind: z.literal("erc20"), assetBytes: evmAddressSchema }),
  z.object({ namespace: z.literal("solana"), reference: solanaKeySchema, kind: z.enum(["native", "spl"]), assetBytes: solanaKeySchema }),
]);

export const collateralAssetSchema = collateralAssetBaseSchema.superRefine((asset, ctx) => {
  if (asset.namespace === "solana" && ((asset.kind === "native") !== (asset.assetBytes === NATIVE_SOL_ASSET_BYTES))) ctx.addIssue({ code: "custom", path: ["assetBytes"], message: "solana-asset-kind-mismatch" });
});

export const collateralSelectionSchema = z.object({
  chain: collateralChainSchema,
  asset: collateralAssetSchema,
  amount: z.bigint().positive(),
  owner: collateralAccountSchema,
  returnRecipient: collateralAccountSchema,
}).superRefine((selection, ctx) => {
  const chain = `${selection.chain.namespace}:${selection.chain.reference}`;
  for (const [name, value] of [["asset", selection.asset], ["owner", selection.owner], ["returnRecipient", selection.returnRecipient]] as const) {
    if (`${value.namespace}:${value.reference}` !== chain) ctx.addIssue({ code: "custom", path: [name], message: "collateral-chain-mismatch" });
  }
  for (const [name, value] of [["owner", selection.owner], ["returnRecipient", selection.returnRecipient]] as const) {
    if (value.namespace === "eip155" && /^0x0{40}$/i.test(value.accountBytes)) ctx.addIssue({ code: "custom", path: [name], message: "zero-address" });
  }
  if (selection.asset.namespace === "eip155" && /^0x0{40}$/i.test(selection.asset.assetBytes)) ctx.addIssue({ code: "custom", path: ["asset"], message: "zero-address" });
});

export const collateralSetupBindingSchema = z.object({
  version: z.literal(1),
  monadChainId: z.number().int().positive(),
  core: evmAddressSchema,
  creditId: hashSchema,
  intentId: hashSchema,
  termsHash: hashSchema,
  borrower: evmAddressSchema,
  house: evmAddressSchema,
  sourceVault: collateralAccountSchema,
  asset: collateralAssetSchema,
  amount: z.bigint().positive(),
  owner: collateralAccountSchema,
  returnRecipient: collateralAccountSchema,
  setupDeadline: z.number().int().positive(),
  nonce: z.bigint().nonnegative(),
}).superRefine((binding, ctx) => {
  const chain = `${binding.asset.namespace}:${binding.asset.reference}`;
  for (const [name, account] of [["sourceVault", binding.sourceVault], ["owner", binding.owner], ["returnRecipient", binding.returnRecipient]] as const) {
    if (`${account.namespace}:${account.reference}` !== chain) ctx.addIssue({ code: "custom", path: [name], message: "collateral-chain-mismatch" });
    if (account.namespace === "eip155" && /^0x0{40}$/i.test(account.accountBytes)) ctx.addIssue({ code: "custom", path: [name], message: "zero-address" });
  }
  for (const name of ["core", "borrower", "house"] as const) {
    if (/^0x0{40}$/i.test(binding[name])) ctx.addIssue({ code: "custom", path: [name], message: "zero-address" });
  }
  if (binding.asset.namespace === "eip155" && /^0x0{40}$/i.test(binding.asset.assetBytes)) ctx.addIssue({ code: "custom", path: ["asset"], message: "zero-address" });
});

export const collateralSetupStageSchema = z.enum([
  "awaiting_borrower", "reserved", "awaiting_source_wallet", "lock_submitted",
  "awaiting_finality", "proof_pending", "proof_submitted", "account_pending",
  "ready", "return_pending", "failed",
]);

export const collateralSetupCheckpointSchema = z.object({
  version: z.literal(1),
  bindingHash: hashSchema,
  creditId: hashSchema,
  termsHash: hashSchema,
  stage: collateralSetupStageSchema,
  borrowerTx: hashSchema.optional(),
  sourceTx: z.string().min(1).optional(),
  lockId: hashSchema.optional(),
  bindTx: hashSchema.optional(),
  proofTx: hashSchema.optional(),
  accountTx: hashSchema.optional(),
  updatedAt: z.number().int().positive(),
});

export type CollateralChain = z.infer<typeof collateralChainSchema>;
export type CollateralAccount = z.infer<typeof collateralAccountSchema>;
export type CollateralAsset = z.infer<typeof collateralAssetSchema>;
export type CollateralSelection = z.infer<typeof collateralSelectionSchema>;
export type CollateralSetupBinding = z.infer<typeof collateralSetupBindingSchema>;
export type CollateralSetupStage = z.infer<typeof collateralSetupStageSchema>;
export type CollateralSetupCheckpoint = z.infer<typeof collateralSetupCheckpointSchema>;
