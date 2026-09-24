import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { solanaRecoveryFundingHash, type SolanaRecoveryFunding } from "../../../packages/sdk/src/collateral/solana-recovery.js";
import { solanaPubkeyBase58 } from "../../../packages/sdk/src/collateral/solana.js";
import { solanaAlias } from "../../src/quote/solana.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/collateral/solana-proof.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/collateral/solana-proof.js")>(),
  fetchSolanaProof: vi.fn(),
}));
vi.mock("../../src/settlement/settlement.repo.js", () => ({ settlementRepo: { get: vi.fn() } }));
vi.mock("@defuse-protocol/one-click-sdk-typescript", async (importOriginal) => ({
  ...await importOriginal<typeof import("@defuse-protocol/one-click-sdk-typescript")>(),
  quoteHash: vi.fn(() => "signed-quote"),
  verifyQuoteSignature: vi.fn(() => true),
}));

import { monadClient } from "../../src/chain/monad.client.js";
import { fetchSolanaProof } from "../../src/collateral/solana-proof.js";
import { env } from "../../src/config/env.js";
import { solanaRecoveryService } from "../../src/collateral/solana-recovery.service.js";
import { settlementRepo } from "../../src/settlement/settlement.repo.js";

const key = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
const address = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(20)}` as `0x${string}`;
const creditId = key(2);
const operationId = key(12);
const operationDigest = key(13);
const inbox = address(14);
const core = address(3);
const factory = address(17);
const borrower = address(18);
const genesis = key(5);
const programId = key(11);
const programDataHash = key(19);
const recoveryVault = key(20);
const lockPda = key(10);
const sourceTx = "2".repeat(88);
const depositPubkey = key(15);
const quoteHash = keccak256(stringToHex("signed-quote"));
const code = "0x1234" as const;
const originalEnv = { core: env.core, monadChainId: env.monadChainId };
const originalSolanaRpc = process.env["SOLANA_RPC_URL"];
const originalSolanaProof = process.env["SOLANA_PROOF_URL"];
const eventTopic = keccak256(stringToHex(
  "SolanaRecoveryFundAuthorized(bytes32,bytes32,bytes32,address,bytes32,uint256,bytes32,uint256,uint256,uint256)",
));

beforeEach(() => {
  env.core = core;
  env.monadChainId = 143;
  process.env["SOLANA_RPC_URL"] = "https://solana.example";
  process.env["SOLANA_PROOF_URL"] = "https://solana-proof.example";
  vi.mocked(fetchSolanaProof).mockResolvedValue({ header: "0xcc", proof: "0xdd", slot: 80,
    blockhash: "So11111111111111111111111111111111111111112" });
});

afterEach(() => {
  Object.assign(env, originalEnv);
  if (originalSolanaRpc === undefined) delete process.env["SOLANA_RPC_URL"];
  else process.env["SOLANA_RPC_URL"] = originalSolanaRpc;
  if (originalSolanaProof === undefined) delete process.env["SOLANA_PROOF_URL"];
  else process.env["SOLANA_PROOF_URL"] = originalSolanaProof;
  vi.clearAllMocks();
});

function setup(options: { debt?: bigint; forgedEmitter?: boolean; acceptedHash?: string;
  pendingHash?: string; verified?: boolean; payout?: boolean } = {}) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const funding: SolanaRecoveryFunding = {
    monadChain: 143n, monadCore: core, sourceGenesis: genesis, programId,
    lockPda, recoveryVault, creditId, lockId: key(1), asset: NATIVE_SOL_ASSET_BYTES,
    operationId, operationDigest, inbox, depositPubkey, amountLamports: 500_000_000n,
    quoteHash, nonce: 1n, revision: 4n, deadline,
  };
  const fundingHash = solanaRecoveryFundingHash(funding);
  vi.mocked(settlementRepo.get).mockResolvedValue({
    kind: "recovery", sourceChain: 1001,
    sourceAsset: solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES), inbox,
    maxAmountIn: funding.amountLamports.toString(),
    sourceRefundRecipient: solanaPubkeyBase58(recoveryVault),
    quote: {
      quote: { depositAddress: solanaPubkeyBase58(depositPubkey),
        amountIn: funding.amountLamports.toString(), deadline: new Date(Number(deadline) * 1000).toISOString() },
      quoteRequest: { recipient: inbox, refundTo: solanaPubkeyBase58(recoveryVault),
        amount: funding.amountLamports.toString() },
    },
  } as never);
  const log = {
    address: options.forgedEmitter ? address(22) : core,
    topics: [eventTopic, creditId, operationId, fundingHash],
    data: encodeAbiParameters([
      { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" },
      { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    ], [inbox, depositPubkey, funding.amountLamports, quoteHash, funding.nonce,
      funding.revision, deadline]),
  };
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => ({
    recoveryKeepers: true,
    creditDetails: { lockId: funding.lockId, collateralVault: solanaAlias(genesis, programId),
      collateralAsset: solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES),
      verifierVersion: 1n, verifierCodeHash: keccak256(code) },
    creditDebt: options.debt ?? 10_000_000n,
    solanaCollateral: true,
    solanaIdentityOf: [genesis, programId, NATIVE_SOL_ASSET_BYTES, key(21), key(22), recoveryVault, 1n],
    solanaLockPdaOf: lockPda, collateralSourceChainOf: 1001n,
    solanaRecoveryOperationFunded: true, remoteSeizureConfirmed: true,
    pendingSolanaFundingHash: options.payout ? key(0) : options.pendingHash ?? fundingHash,
    pendingSolanaFundingOperation: operationId,
    pendingSolanaFundingAmount: funding.amountLamports,
    pendingSolanaFundingNonce: funding.nonce, pendingSolanaFundingDeadline: deadline,
    pendingSolanaPayoutHash: options.payout ? fundingHash : key(0),
    pendingSolanaPayoutNonce: funding.nonce, pendingSolanaPayoutDeadline: deadline,
    solanaRecoveryRefunded: 0n,
    solanaRecoveryFactory: factory, solanaRecoveryFactoryCodeHash: keccak256(code),
    verifierRegistry: address(25),
    verifiers: [address(26), 1n, true, 0n, keccak256(code)],
    verifySolanaFunding: options.verified ?? true,
    verifySolanaFundingAbsence: options.verified ?? true,
    verifySolanaPayout: options.verified ?? true,
    verifySolanaPayoutAbsence: options.verified ?? true,
    verifySolanaRefund: options.verified ?? true,
    inboxOf: inbox, operationDigestOf: operationDigest,
    solanaMarkets: [genesis, programId, programDataHash, NATIVE_SOL_ASSET_BYTES, false],
    solanaRecoveryFundHash: options.acceptedHash ?? fundingHash,
  })[functionName]);
  vi.mocked(monadClient).mockReturnValue({
    getChainId: async () => 143,
    getBlock: async () => ({ number: 100n }),
    getTransactionReceipt: async () => ({ status: "success", blockNumber: 100n, logs: [log] }),
    readContract, getCode: async () => code, call: vi.fn(),
  } as never);
  return { funding, fundingHash, readContract };
}

describe("Solana recovery funding plan", () => {
  it("returns only a finalized, exact Core authorization bound to the registered inbox", async () => {
    const { funding, fundingHash } = setup();
    const plan = await solanaRecoveryService.fundingPlan({ creditId, operationId,
      authorizationTxHash: key(23) }, borrower);
    expect(plan.fundingHash).toBe(fundingHash);
    expect(plan.funding).toMatchObject({ operationDigest, depositPubkey,
      amountLamports: funding.amountLamports.toString(), nonce: "1", revision: "4" });
    expect(plan.programDataHash).toBe(programDataHash);
  });

  it("rejects a forged emitter or a Core hash mismatch", async () => {
    setup({ forgedEmitter: true });
    await expect(solanaRecoveryService.fundingPlan({ creditId, operationId,
      authorizationTxHash: key(23) }, borrower)).rejects.toThrow("solana-funding-log-mismatch");
    setup({ acceptedHash: key(24) });
    await expect(solanaRecoveryService.fundingPlan({ creditId, operationId,
      authorizationTxHash: key(23) }, borrower)).rejects.toThrow("solana-funding-hash-mismatch");
  });

  it("does not offer new source funding once the debt is repaid", async () => {
    setup({ debt: 0n });
    await expect(solanaRecoveryService.fundingPlan({ creditId, operationId,
      authorizationTxHash: key(23) }, borrower)).rejects.toThrow("solana-funding-unavailable");
  });

  it("rejects a signed quote for another Solana deposit account", async () => {
    setup();
    vi.mocked(settlementRepo.get).mockResolvedValueOnce({
      kind: "recovery", sourceChain: 1001,
      sourceAsset: solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES), inbox,
      maxAmountIn: "500000000", sourceRefundRecipient: solanaPubkeyBase58(recoveryVault),
      quote: { quote: { depositAddress: solanaPubkeyBase58(key(31)),
        amountIn: "500000000", deadline: new Date(Date.now() + 3600_000).toISOString() },
        quoteRequest: { recipient: inbox, refundTo: solanaPubkeyBase58(recoveryVault), amount: "500000000" } },
    } as never);
    await expect(solanaRecoveryService.fundingPlan({ creditId, operationId,
      authorizationTxHash: key(23) }, borrower)).rejects.toThrow("solana-funding-quote-mismatch");
  });

  it("rejects a funding authorization that outlives the signed deposit quote", async () => {
    setup();
    vi.mocked(settlementRepo.get).mockResolvedValueOnce({
      kind: "recovery", sourceChain: 1001,
      sourceAsset: solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES), inbox,
      maxAmountIn: "500000000", sourceRefundRecipient: solanaPubkeyBase58(recoveryVault),
      quote: { quote: { depositAddress: solanaPubkeyBase58(depositPubkey),
        amountIn: "500000000", deadline: new Date(Date.now() + 1800_000).toISOString() },
        quoteRequest: { recipient: inbox, refundTo: solanaPubkeyBase58(recoveryVault), amount: "500000000" } },
    } as never);
    await expect(solanaRecoveryService.fundingPlan({ creditId, operationId,
      authorizationTxHash: key(23) }, borrower)).rejects.toThrow("solana-funding-quote-mismatch");
  });

  it("rejects an old funding event after its pending authorization clears", async () => {
    setup({ pendingHash: key(0) });
    await expect(solanaRecoveryService.fundingPlan({ creditId, operationId,
      authorizationTxHash: key(23) }, borrower)).rejects.toThrow("solana-funding-unavailable");
  });

  it("prepares confirmation only after the pinned verifier accepts the recovery ledger proof", async () => {
    const { fundingHash } = setup();
    const plan = await solanaRecoveryService.confirmationPlan({ creditId, operationId,
      mode: "confirm", sourceTx }, borrower);
    expect(plan).toMatchObject({ to: core, actionHash: fundingHash, operationId,
      sourceSlot: 80, mode: "confirm", purpose: "funding" });
    expect(fetchSolanaProof).toHaveBeenCalledWith(expect.objectContaining({
      kind: "recovery", sourceTx, digest: fundingHash, accountPda: recoveryVault,
      lockPda, programDataHash,
    }));
  });

  it("rejects a cancellation if the pinned verifier cannot prove funding absence", async () => {
    setup({ verified: false });
    await expect(solanaRecoveryService.confirmationPlan({ creditId, operationId,
      mode: "cancel", sourceTx }, borrower)).rejects.toThrow("solana-funding-proof-rejected");
  });

  it("prepares a payout confirmation against the separate pending payout and recovery ledger fields", async () => {
    const { fundingHash, readContract } = setup({ payout: true });
    const plan = await solanaRecoveryService.confirmationPlan({ creditId, mode: "confirm", sourceTx }, borrower, "payout");
    expect(plan).toMatchObject({ to: core, actionHash: fundingHash,
      sourceSlot: 80, mode: "confirm", purpose: "payout" });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "verifySolanaPayout", address: address(26),
    }));
  });

  it("prepares refund reconciliation only after the pinned source proof verifies", async () => {
    const { readContract } = setup();
    const plan = await solanaRecoveryService.refundReconciliationPlan({ creditId,
      cumulativeRefunded: "200000000", sourceTx }, borrower);
    expect(plan).toMatchObject({ to: core, creditId, cumulativeRefunded: "200000000",
      sourceSlot: 80 });
    expect(fetchSolanaProof).toHaveBeenCalledWith(expect.objectContaining({
      kind: "recovery", sourceTx, digest: creditId, accountPda: recoveryVault,
    }));
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "verifySolanaRefund", address: address(26),
    }));
  });
});
