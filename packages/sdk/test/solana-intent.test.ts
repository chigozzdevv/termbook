import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256 } from "viem";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { Intent, type Offer } from "../src/intent/intent.js";
import { solanaAlias, solanaPubkeyBase58, solanaPubkeyBytes } from "../src/collateral/solana.js";
import { restoreCollateralSetup } from "../src/collateral/setup.js";
import type { TermbookClient } from "../src/client/client.js";
import type { SourceLockWallet } from "../src/collateral/setup.js";

const addr = (c: string) => `0x${c.repeat(40)}` as `0x${string}`;
const key = (c: string) => `0x${c.repeat(64)}` as `0x${string}`;

describe("Solana collateral acceptance", () => {
  it("converts wallet base58 keys to canonical 32-byte identities", () => {
    const walletKey = "So11111111111111111111111111111111111111112";
    const bytes = solanaPubkeyBytes(walletKey);
    expect(bytes).toMatch(/^0x[0-9a-f]{64}$/);
    expect(solanaPubkeyBase58(bytes)).toBe(walletKey);
    expect(() => solanaPubkeyBytes("11111111111111111111111111111111")).toThrow();
    expect(() => solanaPubkeyBytes(`${walletKey}0`)).toThrow();
  });

  it("passes full 32-byte identities into the signed Core quote and keeps the source lock pending", async () => {
    const genesis = key("f");
    const programId = key("1");
    const owner = key("2");
    const recipient = key("3");
    const recoveryVault = key("4");
    const borrower = addr("5");
    const house = addr("6");
    const coreAddress = addr("7");
    const vault = addr("8");
    const settlementAsset = addr("9");
    const intentId = key("a");
    const termsHash = key("b");
    const alias = (id: `0x${string}`) => solanaAlias(genesis, id);
    const offer: Offer = {
      id: "solana-offer", kind: "solana", intentId, borrower, house, vault,
      owner: alias(owner), sourceChain: 1001, collateralVault: alias(programId),
      collateralAsset: alias(NATIVE_SOL_ASSET_BYTES), collateralAmount: 1_000_000_000n,
      returnRecipient: alias(recipient), settlementAsset, limit: 100n, aprBps: 500,
      originationFee: 0n, commitmentFeeBps: 0, expiry: 9999999998,
      maturity: 10000000000, setupDeadline: 9999999999, grace: 0, reservationBond: 0n,
      nonce: 1n, bundleId: key("c"), termsHash, signature: `0x${"d".repeat(130)}` as `0x${string}`,
      revolving: false,
      solana: { sourceGenesis: genesis, sourceVault: programId, sourceAsset: NATIVE_SOL_ASSET_BYTES,
        sourceOwner: owner, returnRecipient: recipient, recoveryVault, verifierVersion: 1n },
    };
    const creditId = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [intentId, borrower, house, offer.nonce],
    ));
    let reserved = false;
    let submitted = 0;
    let signedQuote: Record<string, unknown> | undefined;
    const client = {
      config: { chainId: 143, core: coreAddress, apiBase: "https://invalid.example", wallet: { getChainId: async () => 143 } },
      signer: { address: () => borrower },
      rpc: {
        creditDetails: async () => reserved ? {
          revision: 2n, facility: 1, borrower, house, termsHash,
          collateralVault: alias(programId), collateralAsset: alias(NATIVE_SOL_ASSET_BYTES),
          collateralAmount: offer.collateralAmount, returnRecipient: alias(recipient),
          collateralBound: false, account: addr("0"), lockId: key("0"),
        } : { revision: 0n },
        read: async (_address: string, _abi: unknown, fn: string) => {
          if (fn === "asset") return settlementAsset;
          if (fn === "collateralSourceChainOf") return 1001n;
          if (fn === "collateralOwnerOf") return alias(owner);
          if (fn === "solanaIdentityOf") return { sourceGenesis: genesis, programId, sourceAsset: NATIVE_SOL_ASSET_BYTES, sourceOwner: owner, returnRecipient: recipient, recoveryVault, verifierVersion: 1n };
          if (fn === "solanaMarkets") return { sourceGenesis: genesis, programId, sourceAsset: NATIVE_SOL_ASSET_BYTES, recoveryVault, active: true };
          if (fn === "collateralProven") return false;
          throw new Error(`unexpected-read:${fn}`);
        },
        coreWrite: async (fn: string, args: unknown[]) => {
          if (fn !== "acceptSolanaQuote") throw new Error(`unexpected-write:${fn}`);
          signedQuote = args[0] as Record<string, unknown>;
          reserved = true;
          return key("e");
        },
        wait: async () => ({ status: "success" }),
      },
    } as unknown as TermbookClient;
    const ref = { namespace: "solana" as const, reference: genesis };
    const intent = new Intent(client, {
      collateral: {
        chain: ref, asset: { ...ref, kind: "native", assetBytes: NATIVE_SOL_ASSET_BYTES },
        amount: offer.collateralAmount!, owner: { ...ref, accountBytes: owner },
        returnRecipient: { ...ref, accountBytes: recipient },
      },
      credit: { limit: 100n, duration: 3600 },
    });
    intent.offers = async () => [offer];
    const sourceWallet: SourceLockWallet = {
      account: { ...ref, accountBytes: owner },
      remoteRecoveryVault: async () => recoveryVault,
      lockPda: async () => key("d"),
      observeLock: async () => ({ state: submitted ? "submitted" : "missing", txId: submitted ? "source-tx" : undefined }),
      submitLock: async () => { submitted++; return { txId: "source-tx" }; },
    };
    const credit = await intent.accept({ offerId: offer.id, source_wallet: sourceWallet });
    expect(credit.id).toBe(creditId);
    expect(credit.setup?.snapshot().stage).toBe("awaiting_finality");
    expect(submitted).toBe(1);
    expect(signedQuote).toMatchObject({
      sourceGenesis: genesis, sourceVault: programId, sourceAsset: NATIVE_SOL_ASSET_BYTES,
      sourceOwner: owner, returnRecipient: recipient, recoveryVault, verifierVersion: 1n,
      quote: { borrower, owner: alias(owner), collateralVault: alias(programId) },
    });
    const snapshot = credit.setup!.serialize();
    expect(restoreCollateralSetup(snapshot).binding.verifierVersion).toBe(1n);
    const tampered = JSON.parse(snapshot) as { binding: { recoveryVault: { accountBytes: string } } };
    tampered.binding.recoveryVault.accountBytes = key("e");
    expect(() => restoreCollateralSetup(JSON.stringify(tampered))).toThrow("setup-checkpoint-mismatch");
  });
});
