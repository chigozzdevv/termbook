import { describe, expect, it } from "vitest";
import { collateralSelectSchema } from "../src/intent.js";
import { quoteSchema } from "../src/quote.js";
import { operationSchema } from "../src/settlement.js";
import { collateralSetupBindingSchema, NATIVE_SOL_ASSET_BYTES } from "../src/collateral-setup.js";
import { solanaIntentCollateralSchema } from "../src/intent.js";

describe("schema", () => {
  it("rejects bad address", () => {
    expect(() => collateralSelectSchema.parse({ chainId: 1, asset: "bad", amount: 1n })).toThrow();
  });

  it("accepts quote", () => {
    const q = {
      id: "q1",
      borrower: "0x0000000000000000000000000000000000000001",
      house: "0x0000000000000000000000000000000000000002",
      vault: "0x0000000000000000000000000000000000000003",
      limit: 1000n,
      maturity: 9999999999,
      expiry: 9999999999,
      bundleId: "0x0000000000000000000000000000000000000000000000000000000000000001",
      termsHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
      aprBps: 500,
    };
    expect(quoteSchema.parse(q).id).toBe("q1");
  });

  it("requires operation identity fields", () => {
    const operation = {
      operationId: `0x${"1".repeat(64)}`,
      kind: "repay" as const,
      payer: `0x${"1".repeat(40)}`,
      nonce: 1n,
      sourceChain: 1,
      sourceAsset: `0x${"2".repeat(40)}`,
      maxAmountIn: 100n,
      vault: `0x${"3".repeat(40)}`,
      creditId: `0x${"4".repeat(64)}`,
      minAmountOut: 90n,
      deadline: 9999999999,
      refundRecipient: `0x${"5".repeat(40)}`,
    };
    expect(operationSchema.parse(operation).nonce).toBe(1n);
    expect(() => operationSchema.parse({ ...operation, minAmountOut: -1n })).toThrow();
  });

  it("keeps Solana account bytes distinct from EVM addresses and rejects Bitcoin selections", () => {
    const common = {
      version: 1,
      monadChainId: 143,
      core: `0x${"1".repeat(40)}`,
      creditId: `0x${"2".repeat(64)}`,
      intentId: `0x${"3".repeat(64)}`,
      termsHash: `0x${"4".repeat(64)}`,
      borrower: `0x${"5".repeat(40)}`,
      house: `0x${"6".repeat(40)}`,
      amount: 1n,
      setupDeadline: 9999999999,
      nonce: 0n,
    };
    const solana = { namespace: "solana", reference: `0x${"f".repeat(64)}`, accountBytes: `0x${"7".repeat(64)}` };
    const solanaBinding = {
      ...common,
      sourceVault: solana,
      asset: { namespace: "solana", reference: solana.reference, kind: "native", assetBytes: NATIVE_SOL_ASSET_BYTES },
      owner: solana,
      returnRecipient: solana,
      recoveryVault: { ...solana, accountBytes: `0x${"8".repeat(64)}` },
      sourceChainId: 1001,
      verifierVersion: 1n,
    };
    expect(collateralSetupBindingSchema.parse(solanaBinding).asset.namespace).toBe("solana");
    expect(solanaIntentCollateralSchema.parse({ chain: { namespace: "solana", reference: solana.reference }, asset: solanaBinding.asset, owner: solana, returnRecipient: solana, amount: "1" }).amount).toBe("1");
    expect(() => solanaIntentCollateralSchema.parse({ chain: { namespace: "solana", reference: `0x${"e".repeat(64)}` }, asset: solanaBinding.asset, owner: solana, returnRecipient: solana, amount: "1" })).toThrow();
    expect(() => collateralSetupBindingSchema.parse({ ...solanaBinding, recoveryVault: undefined })).toThrow();
    expect(() => collateralSetupBindingSchema.parse({ ...solanaBinding, asset: { ...solanaBinding.asset, assetBytes: `0x${"8".repeat(64)}` } })).toThrow();
    expect(() => collateralSetupBindingSchema.parse({ ...solanaBinding, owner: { ...solana, accountBytes: `0x${"0".repeat(64)}` } })).toThrow();
    expect(() => collateralSetupBindingSchema.parse({ ...solanaBinding, owner: { ...solana, accountBytes: `0x${"9".repeat(40)}` } })).toThrow();
    const bitcoin = { namespace: "bip122", reference: "000000000019d6689c085ae165831e93", accountBytes: `0x5120${"a".repeat(64)}` };
    expect(() => collateralSetupBindingSchema.parse({
      ...common,
      sourceVault: bitcoin,
      asset: { namespace: "bip122", reference: bitcoin.reference, kind: "btc", assetBytes: "0x00" },
      owner: bitcoin,
      returnRecipient: bitcoin,
    })).toThrow();
    expect(() => collateralSetupBindingSchema.parse({ ...solanaBinding, returnRecipient: bitcoin })).toThrow();
    expect(() => collateralSetupBindingSchema.parse({
      ...common,
      sourceVault: { namespace: "eip155", reference: "143", accountBytes: `0x${"0".repeat(40)}` },
      asset: { namespace: "eip155", reference: "143", kind: "erc20", assetBytes: `0x${"1".repeat(40)}` },
      owner: { namespace: "eip155", reference: "143", accountBytes: `0x${"2".repeat(40)}` },
      returnRecipient: { namespace: "eip155", reference: "143", accountBytes: `0x${"3".repeat(40)}` },
    })).toThrow();
  });
});
