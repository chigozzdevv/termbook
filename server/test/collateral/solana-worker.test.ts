import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { solanaAlias } from "../../src/quote/solana.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/collateral/solana.config.js", () => ({ solanaProofConfig: vi.fn() }));
vi.mock("../../src/collateral/solana-proof.js", () => ({ fetchSolanaProof: vi.fn() }));
vi.mock("../../src/queue/queue.worker.js", () => ({ registerHandler: vi.fn(), drainQueue: vi.fn() }));
vi.mock("../../src/collateral/solana.repo.js", () => ({ solanaRepo: {
  claim: vi.fn(), releaseClaim: vi.fn(), find: vi.fn(), setPrepared: vi.fn(),
  acquireSigner: vi.fn(), releaseSigner: vi.fn(), setProven: vi.fn(), setMined: vi.fn(),
  clearReverted: vi.fn(), setReview: vi.fn(), pending: vi.fn(),
} }));
vi.mock("viem", async (original) => ({ ...(await original<typeof import("viem")>()), createWalletClient: vi.fn() }));

import { monadClient } from "../../src/chain/monad.client.js";
import { fetchSolanaProof } from "../../src/collateral/solana-proof.js";
import { solanaProofConfig } from "../../src/collateral/solana.config.js";
import { solanaRepo } from "../../src/collateral/solana.repo.js";
import { handleSolanaLockJob } from "../../src/collateral/solana.worker.js";
import { createWalletClient } from "viem";
import { env } from "../../src/config/env.js";

const id = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const lockId = id("1");
const creditId = id("2");
const pda = id("3");
const genesis = id("4");
const programId = id("5");
const programDataHash = id("e");
const owner = id("6");
const recipient = id("7");
const recovery = id("8");
const verifier = address("9");
const core = address("a");
const code = "0x1234" as const;
const codeHash = keccak256(code);
const originalEnv = { core: env.core, monadChainId: env.monadChainId, rpcUrl: env.rpcUrl };

beforeEach(() => {
  env.core = core;
  env.monadChainId = 143;
  env.rpcUrl = "https://monad.example";
  vi.mocked(solanaProofConfig).mockReturnValue({ rpcUrl: "https://solana.example",
    proofUrl: "https://proof.example", keeper: { address: address("b") } } as never);
  vi.mocked(solanaRepo.claim).mockResolvedValue("lease");
  vi.mocked(solanaRepo.find).mockResolvedValue({ lockId, creditId, lockPda: pda, state: "pending" } as never);
  vi.mocked(solanaRepo.acquireSigner).mockResolvedValue(true);
  vi.mocked(solanaRepo.setPrepared).mockResolvedValue({ matchedCount: 1 } as never);
  vi.mocked(fetchSolanaProof).mockResolvedValue({ header: "0x12", proof: "0x34", slot: 80,
    blockhash: "So11111111111111111111111111111111111111112" });
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.clearAllMocks();
});

function chain(verified: boolean) {
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => ({
    creditDetails: { collateralBound: true, lockId, facility: 2, collateralVault: solanaAlias(genesis, programId),
      collateralAsset: solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES),
      returnRecipient: solanaAlias(genesis, recipient), verifierVersion: 1n, verifierCodeHash: codeHash },
    collateralSourceChainOf: 1001n, solanaCollateral: true,
    solanaIdentityOf: [genesis, programId, NATIVE_SOL_ASSET_BYTES, owner, recipient, recovery, 1n],
    solanaLockPdaOf: pda, collateralProven: false,
    solanaMarkets: [genesis, programId, programDataHash, NATIVE_SOL_ASSET_BYTES, false],
    verifierRegistry: address("c"), solanaLockDigest: id("d"),
    verifiers: [verifier, 1n, true, 0n, codeHash], verifySolanaLock: verified,
  })[functionName]);
  const sendRawTransaction = vi.fn(async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => keccak256(serializedTransaction));
  vi.mocked(monadClient).mockReturnValue({
    getChainId: async () => 143, getBlock: async () => ({ number: 100n }),
    readContract, getCode: async () => code, call: vi.fn(), getTransactionCount: async () => 1,
    getTransactionReceipt: async () => null, sendRawTransaction, waitForTransactionReceipt: async () => null,
  } as never);
  return { readContract, sendRawTransaction };
}

describe("Solana lock proof relay", () => {
  it("rejects an unverified Solana proof before signing", async () => {
    chain(false);
    await expect(handleSolanaLockJob({ kind: "collateral.solana-lock", payload: { lockId } }))
      .rejects.toThrow("solana-proof-rejected");
    expect(solanaRepo.setPrepared).not.toHaveBeenCalled();
    expect(createWalletClient).not.toHaveBeenCalled();
    expect(solanaRepo.releaseClaim).toHaveBeenCalledWith(lockId, "lease");
  });

  it("persists the signed Monad proof transaction before broadcast", async () => {
    const source = chain(true);
    vi.mocked(createWalletClient).mockReturnValue({
      prepareTransactionRequest: async () => ({ account: address("b"), nonce: 1 }),
      signTransaction: async () => "0xabcd",
    } as never);
    await handleSolanaLockJob({ kind: "collateral.solana-lock", payload: { lockId } });
    expect(fetchSolanaProof).toHaveBeenCalledWith(expect.objectContaining({
      kind: "lock", id: lockId, digest: id("d"), genesis, programId, programDataHash, lockPda: pda,
    }));
    expect(solanaRepo.setPrepared).toHaveBeenCalledWith(lockId, expect.any(Object), keccak256("0xabcd"), "0xabcd");
    expect(source.sendRawTransaction).toHaveBeenCalledOnce();
    expect(vi.mocked(solanaRepo.setPrepared).mock.invocationCallOrder[0])
      .toBeLessThan(source.sendRawTransaction.mock.invocationCallOrder[0]!);
  });
});
