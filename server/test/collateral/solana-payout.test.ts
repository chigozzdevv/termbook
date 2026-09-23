import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { solanaRecoveryPayoutHash, type SolanaRecoveryPayout } from "../../../packages/sdk/src/collateral/solana-recovery.js";
import { solanaAlias } from "../../src/quote/solana.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/monad-receipt-proof.js", () => ({ fetchMonadReceiptProof: vi.fn() }));

import { monadClient } from "../../src/chain/monad.client.js";
import { fetchMonadReceiptProof } from "../../src/chain/monad-receipt-proof.js";
import { env } from "../../src/config/env.js";
import { solanaPayoutService } from "../../src/collateral/solana-payout.service.js";

const key = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
const address = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(20)}` as `0x${string}`;
const core = address(3);
const borrower = address(4);
const creditId = key(2);
const genesis = key(5);
const programId = key(11);
const recipient = key(6);
const recoveryVault = key(7);
const lockPda = key(10);
const programDataHash = key(8);
const eventTopic = keccak256(stringToHex(
  "SolanaRecoveryReturnAuthorized(bytes32,bytes32,bytes32,uint256,uint256,uint256,uint256)",
));
const originalEnv = { core: env.core, monadChainId: env.monadChainId, monadProofUrl: env.monadProofUrl };

beforeEach(() => {
  env.core = core;
  env.monadChainId = 143;
  env.monadProofUrl = "https://proof.example";
});

afterEach(() => { Object.assign(env, originalEnv); vi.clearAllMocks(); });

function setup(options: { pendingHash?: string; recipient?: `0x${string}` } = {}) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const payout: SolanaRecoveryPayout = {
    monadChain: 143n, monadCore: core, sourceGenesis: genesis, programId,
    lockPda, recoveryVault, creditId, lockId: key(1), asset: NATIVE_SOL_ASSET_BYTES,
    recipient, amountLamports: 500_000_000n, nonce: 1n, revision: 4n, deadline,
  };
  const payoutHash = solanaRecoveryPayoutHash(payout);
  const log = {
    address: core, topics: [eventTopic, creditId, payoutHash, options.recipient ?? recipient],
    data: encodeAbiParameters([
      { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    ], [payout.amountLamports, payout.nonce, payout.revision, payout.deadline]),
  };
  vi.mocked(fetchMonadReceiptProof).mockImplementation(async ({ selectLog }) => {
    expect(selectLog({ status: "success", logs: [log] } as never)).toBe(0);
    return { header: "0xaa", proof: "0xbb" } as never;
  });
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => ({
    creditDetails: { borrower, lockId: payout.lockId,
      collateralVault: solanaAlias(genesis, programId),
      collateralAsset: solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES),
      returnRecipient: solanaAlias(genesis, recipient) },
    creditDebt: 0n, solanaCollateral: true, remoteSeizureConfirmed: true,
    solanaIdentityOf: [genesis, programId, NATIVE_SOL_ASSET_BYTES, key(9), recipient, recoveryVault, 1n],
    solanaLockPdaOf: lockPda, collateralSourceChainOf: 1001n,
    pendingSolanaPayoutHash: options.pendingHash ?? payoutHash,
    pendingSolanaPayoutAmount: payout.amountLamports,
    pendingSolanaPayoutNonce: payout.nonce, pendingSolanaPayoutDeadline: deadline,
    solanaMarkets: [genesis, programId, programDataHash, NATIVE_SOL_ASSET_BYTES, false],
    solanaRecoveryReturnHash: payoutHash,
  })[functionName]);
  vi.mocked(monadClient).mockReturnValue({
    getChainId: async () => 143,
    getBlock: async () => ({ number: 100n }),
    readContract,
  } as never);
  return { payout, payoutHash };
}

describe("Solana recovery payout plan", () => {
  it("requires a finalized payout event, matching pending authorization, and the borrower", async () => {
    const { payout, payoutHash } = setup();
    const plan = await solanaPayoutService.plan({ creditId, authorizationTxHash: key(20) }, borrower);
    expect(plan).toMatchObject({ payoutHash, programDataHash,
      payout: { recipient, amountLamports: payout.amountLamports.toString(), revision: "4" } });
  });

  it("rejects an old authorization or a changed source recipient", async () => {
    setup({ pendingHash: key(0) });
    await expect(solanaPayoutService.plan({ creditId, authorizationTxHash: key(20) }, borrower))
      .rejects.toThrow("solana-payout-unavailable");
    setup({ recipient: key(21) });
    await expect(solanaPayoutService.plan({ creditId, authorizationTxHash: key(20) }, borrower))
      .rejects.toThrow("solana-payout-binding-mismatch");
  });
});
