import { describe, expect, it } from "vitest";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { intentSchema } from "../../src/intent/intent.schema.js";
import { quoteSchema } from "../../src/quote/quote.schema.js";
import { matchesSolanaAliases, solanaAlias, solanaQuoteDigest } from "../../src/quote/solana.js";

const genesis = `0x${"f".repeat(64)}` as const;
const program = `0x${"1".repeat(64)}` as const;
const owner = `0x${"2".repeat(64)}` as const;
const recipient = `0x${"3".repeat(64)}` as const;
const recovery = `0x${"4".repeat(64)}` as const;
const identity = {
  sourceGenesis: genesis, sourceVault: program, sourceAsset: NATIVE_SOL_ASSET_BYTES,
  sourceOwner: owner, returnRecipient: recipient, recoveryVault: recovery, verifierVersion: 1n,
};
const aliases = {
  owner: solanaAlias(genesis, owner), collateralVault: solanaAlias(genesis, program),
  collateralAsset: solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES), returnRecipient: solanaAlias(genesis, recipient),
};

describe("Solana quote identities", () => {
  it("accepts native SOL intent while rejecting mismatched genesis and asset", () => {
    const account = (accountBytes: string) => ({ namespace: "solana", reference: genesis, accountBytes });
    const collateral = {
      chain: { namespace: "solana", reference: genesis },
      asset: { namespace: "solana", reference: genesis, kind: "native", assetBytes: NATIVE_SOL_ASSET_BYTES },
      owner: account(owner), returnRecipient: account(recipient), amount: "1000000000",
    };
    const input = { borrower: `0x${"5".repeat(40)}`, collateral, duration: 3600, limit: "100" };
    expect(intentSchema.parse(input)).toMatchObject(input);
    expect(() => intentSchema.parse({ ...input, collateral: { ...collateral, chain: { namespace: "solana", reference: `0x${"e".repeat(64)}` } } })).toThrow();
    expect(() => intentSchema.parse({ ...input, collateral: { ...collateral, asset: { ...collateral.asset, assetBytes: owner } } })).toThrow();
  });

  it("binds aliases and requires complete 32-byte source terms", () => {
    expect(matchesSolanaAliases(aliases, identity)).toBe(true);
    expect(matchesSolanaAliases({ ...aliases, owner: aliases.collateralVault }, identity)).toBe(false);
    const quote = {
      kind: "solana", intentId: `0x${"6".repeat(64)}`, borrower: `0x${"5".repeat(40)}`,
      house: `0x${"7".repeat(40)}`, vault: `0x${"8".repeat(40)}`, ...aliases,
      sourceChain: 1001, collateralAmount: "1000000000", settlementAsset: `0x${"9".repeat(40)}`,
      limit: "100", aprBps: 500, maturity: 9999999999, setupDeadline: 9999999000,
      grace: 0, nonce: "1", expiry: 9999998000, bundleId: `0x${"a".repeat(64)}`,
      termsHash: `0x${"b".repeat(64)}`, signature: `0x${"c".repeat(130)}`,
      domain: `0x${"d".repeat(64)}`,
      solana: { ...identity, verifierVersion: "1" },
    };
    expect(quoteSchema.parse(quote).kind).toBe("solana");
    expect(() => quoteSchema.parse({ ...quote, solana: { ...quote.solana, sourceOwner: `0x${"2".repeat(40)}` } })).toThrow();
    expect(() => quoteSchema.parse({ ...quote, solana: { ...quote.solana, sourceAsset: owner } })).toThrow();
    expect(() => quoteSchema.parse({ ...quote, collateralAmount: (1n << 64n).toString() })).toThrow();
  });

  it("domain separates Solana signatures", () => {
    const base = `0x${"a".repeat(64)}` as const;
    const digest = solanaQuoteDigest(base, identity);
    expect(digest).not.toBe(base);
    expect(solanaQuoteDigest(base, { ...identity, recoveryVault: owner })).not.toBe(digest);
  });
});
