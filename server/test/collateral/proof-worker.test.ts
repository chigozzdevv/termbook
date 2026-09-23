import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/source.client.js", () => ({ fetchProof: vi.fn() }));
vi.mock("../../src/queue/queue.worker.js", () => ({ registerHandler: vi.fn(), drainQueue: vi.fn() }));
vi.mock("viem", async (original) => ({ ...(await original<typeof import("viem")>()), createWalletClient: vi.fn() }));
vi.mock("../../src/collateral/collateral.repo.js", () => ({
  collateralRepo: {
    find: vi.fn(), setState: vi.fn(), setPrepared: vi.fn(), clearReverted: vi.fn(),
    acquireSigner: vi.fn(), releaseSigner: vi.fn(), setMined: vi.fn(),
    setProvenWithoutTx: vi.fn(), setProvenFromTx: vi.fn(), setReview: vi.fn(),
  },
}));

import { monadClient } from "../../src/chain/monad.client.js";
import { createWalletClient, keccak256 } from "viem";
import { fetchProof } from "../../src/chain/source.client.js";
import { collateralRepo } from "../../src/collateral/collateral.repo.js";
import { env } from "../../src/config/env.js";
import { handleCollateralJob } from "../../src/collateral/collateral.worker.js";

const lockId = `0x${"11".repeat(32)}` as const;
const creditId = `0x${"22".repeat(32)}` as const;
const owner = `0x${"33".repeat(20)}` as const;
const vault = `0x${"44".repeat(20)}` as const;
const asset = `0x${"55".repeat(20)}` as const;
const recovery = `0x${"66".repeat(20)}` as const;
const registry = `0x${"77".repeat(20)}` as const;
const verifier = `0x${"88".repeat(20)}` as const;
const codeHash = keccak256("0x1234");

const originalConfig = {
  sourceRpcUrl: env.sourceRpcUrl,
  sourceProofUrl: env.sourceProofUrl,
  collateralKeeperKey: env.collateralKeeperKey,
  monadChainId: env.monadChainId,
  core: env.core,
};

beforeEach(() => {
  env.sourceRpcUrl = "https://ethereum.example";
  env.sourceProofUrl = "https://finality.example";
  env.collateralKeeperKey = `0x${"aa".repeat(32)}`;
  env.monadChainId = 143;
  env.core = `0x${"bb".repeat(20)}`;
  vi.mocked(collateralRepo.find).mockResolvedValue({ lockId, creditId, owner, amount: "100" } as never);
  vi.mocked(collateralRepo.setPrepared).mockResolvedValue({ matchedCount: 1 } as never);
  vi.mocked(collateralRepo.acquireSigner).mockResolvedValue(true);
  vi.mocked(fetchProof).mockResolvedValue({ header: "0x1234", proof: "0xabcd", finalized: true } as never);
});

afterEach(() => {
  Object.assign(env, originalConfig);
  vi.clearAllMocks();
});

function source(overrides: Record<string, unknown> = {}, proven = false, accepted = false, initialProvenReads = 1) {
  const credit = {
    facility: 2, collateralBound: true, lockId, collateralAmount: 100n,
    collateralVault: vault, collateralAsset: asset, borrower: owner,
    returnRecipient: owner, verifierVersion: 1n, verifierCodeHash: codeHash,
    ...overrides,
  };
  const call = vi.fn();
  let provenReads = 0;
  const readContract = vi.fn(async (request: { functionName: string }) => {
    switch (request.functionName) {
      case "creditDetails": return credit;
      case "collateralSourceChainOf": return 1n;
      case "remoteCollateral": return true;
      case "collateralOwnerOf": return owner;
      case "remoteRecoveryVaultOf": return recovery;
      case "collateralProven": return proven || ++provenReads > initialProvenReads && accepted;
      case "sourceCollateralVault": return vault;
      case "verifierRegistry": return registry;
      case "verifiers": return [verifier, 1n, true, 3600n, codeHash];
      case "sourceVault": return vault;
      case "sourceVaultCodeHash": return codeHash;
      case "verifyLock": return accepted;
      default: throw new Error(`unexpected ${request.functionName}`);
    }
  });
  const getTransactionReceipt = vi.fn(async () => null);
  const sendRawTransaction = vi.fn(async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => keccak256(serializedTransaction));
  const waitForTransactionReceipt = vi.fn(async () => ({ status: "success", blockNumber: 10n, blockHash: `0x${"cc".repeat(32)}` }));
  const getBlock = vi.fn(async () => ({ number: 10n, hash: `0x${"cc".repeat(32)}` }));
  vi.mocked(monadClient).mockReturnValue({
    getChainId: async () => 143, readContract, call, getTransactionReceipt, sendRawTransaction,
    waitForTransactionReceipt, getBlock, getCode: async () => "0x1234", getTransactionCount: async () => 0,
  } as never);
  return { readContract, call, sendRawTransaction, waitForTransactionReceipt };
}

describe("Ethereum collateral relay", () => {
  it("reconciles a previously proven lock after its collateral amount changes", async () => {
    source({ facility: 4, collateralAmount: 0n }, true);
    await handleCollateralJob({ kind: "collateral.tracked", payload: { lockId } });
    expect(collateralRepo.setProvenWithoutTx).toHaveBeenCalledWith(lockId);
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it("rejects a forged tracked amount before requesting any proof", async () => {
    source();
    vi.mocked(collateralRepo.find).mockResolvedValue({ lockId, creditId, owner, amount: "101" } as never);
    await expect(handleCollateralJob({ kind: "collateral.tracked", payload: { lockId } })).rejects.toThrow("collateral-core-mismatch");
    expect(fetchProof).not.toHaveBeenCalled();
  });

  it("never signs or relays a proof rejected by the onchain verifier", async () => {
    const chain = source();
    await expect(handleCollateralJob({ kind: "collateral.tracked", payload: { lockId } })).rejects.toThrow("collateral-proof-rejected");
    expect(fetchProof).toHaveBeenCalledWith(expect.objectContaining({ lockId, vault, expectedCodeHash: codeHash }));
    expect(chain.call).not.toHaveBeenCalled();
    expect(collateralRepo.setPrepared).not.toHaveBeenCalled();
  });

  it("does not sign while another lock holds the Monad keeper nonce", async () => {
    const chain = source({}, false, true);
    vi.mocked(collateralRepo.acquireSigner).mockResolvedValue(false);
    await expect(handleCollateralJob({ kind: "collateral.tracked", payload: { lockId } }))
      .rejects.toThrow("collateral-proof-signer-busy");
    expect(createWalletClient).not.toHaveBeenCalled();
    expect(chain.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("persists a signed transaction before broadcasting an accepted proof", async () => {
    const chain = source({}, false, true);
    const prepareTransactionRequest = vi.fn(async () => ({ account: owner, to: env.core, data: "0xabcd", nonce: 0, chainId: 143, gas: 1_000_000n, gasPrice: 1n }));
    const signTransaction = vi.fn(async () => "0x1234");
    vi.mocked(createWalletClient).mockReturnValue({ prepareTransactionRequest, signTransaction } as never);
    await handleCollateralJob({ kind: "collateral.tracked", payload: { lockId } });
    expect(chain.call).toHaveBeenCalledOnce();
    expect(collateralRepo.setPrepared).toHaveBeenCalledWith(lockId, expect.any(Object), keccak256("0x1234"), "0x1234");
    expect(chain.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: "0x1234" });
    expect(vi.mocked(collateralRepo.setPrepared).mock.invocationCallOrder[0]).toBeLessThan(chain.sendRawTransaction.mock.invocationCallOrder[0]!);
    expect(collateralRepo.setProvenFromTx).toHaveBeenCalledWith(lockId, keccak256("0x1234"));
    expect(collateralRepo.releaseSigner).toHaveBeenCalledWith(143, expect.any(String), lockId);
  });

  it("never broadcasts a transaction that lost the atomic submission race", async () => {
    const chain = source({}, false, true, 2);
    const tracked = { lockId, creditId, owner, amount: "100" };
    let reads = 0;
    vi.mocked(collateralRepo.find).mockImplementation(async () => {
      reads += 1;
      return (reads <= 4 ? tracked : { ...tracked, txHash: keccak256("0x1234"), rawTx: "0x1234" }) as never;
    });
    let prepared = 0;
    vi.mocked(collateralRepo.setPrepared).mockImplementation(async () => ({ matchedCount: ++prepared === 1 ? 1 : 0 }) as never);
    const prepareTransactionRequest = vi.fn(async () => ({ account: owner, to: env.core, data: "0xabcd", nonce: 0, chainId: 143, gas: 1_000_000n, gasPrice: 1n }));
    let signed = 0;
    const signTransaction = vi.fn(async () => ++signed === 1 ? "0x1234" : "0x5678");
    vi.mocked(createWalletClient).mockReturnValue({ prepareTransactionRequest, signTransaction } as never);
    const results = await Promise.allSettled([
      handleCollateralJob({ kind: "collateral.tracked", payload: { lockId } }),
      handleCollateralJob({ kind: "collateral.tracked", payload: { lockId } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(chain.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(collateralRepo.find).toHaveBeenCalledTimes(5);
    expect(collateralRepo.setPrepared).toHaveBeenCalledTimes(2);
  });
});
