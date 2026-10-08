import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import type { Hex } from "viem";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn() }));
vi.mock("../../src/collateral/remote-action.service.js", () => ({ verifyAuthorizationReceipt: vi.fn() }));
vi.mock("../../src/collateral/solana-action.service.js", () => ({ readSolanaAction: vi.fn(),
  solanaActionService: { confirmationPlan: vi.fn() } }));
vi.mock("../../src/collateral/solana-relay.program.js", () => ({ verifySolanaRelayProgram: vi.fn() }));
vi.mock("../../src/collateral/solana-relay.repo.js", () => ({ solanaRelayRepo: {
  transactions: vi.fn(), completed: vi.fn(), sourced: vi.fn(),
  claim: vi.fn(), release: vi.fn(), renew: vi.fn(),
} }));
vi.mock("../../src/collateral/solana-relay.config.js", () => ({ solanaRelayConfig: vi.fn() }));
vi.mock("../../src/collateral/solana-relay.transaction.js", () => ({ deliverSolanaRelay: vi.fn(), sendSolanaRelay: vi.fn() }));
vi.mock("../../src/queue/queue.worker.js", () => ({ registerHandler: vi.fn(), drainQueue: vi.fn() }));

import { processSolanaRelay, runSolanaRelayWorker } from "../../src/collateral/solana-relay.worker.js";
import { solanaRelayConfig } from "../../src/collateral/solana-relay.config.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { keeperTransaction } from "../../src/chain/keeper.js";
import { env } from "../../src/config/env.js";
import { readSolanaAction, solanaActionService } from "../../src/collateral/solana-action.service.js";
import { solanaRelayRepo } from "../../src/collateral/solana-relay.repo.js";
import { deliverSolanaRelay } from "../../src/collateral/solana-relay.transaction.js";

const hash = `0x${"1".repeat(64)}` as Hex;
const action = { _id: hash, creditId: hash, kind: 0 as const, authorizationTxHash: hash,
  sourceTx: "2".repeat(88), mode: "apply" as const };
const config = { rpcUrl: "http://127.0.0.1:8899", proofUrl: "https://proof.example", keeper: {} as never,
  signer: Keypair.fromSeed(new Uint8Array(32).fill(1)), maxTransactions: 64, wormholeScanUrl: "https://proof.example" };
beforeEach(() => {
  vi.resetAllMocks(); env.monadChainId = 143; env.core = `0x${"1".repeat(40)}`;
  vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 143,
    getBlock: async () => ({ number: 10n }), readContract: async () => hash } as never);
  vi.mocked(readSolanaAction).mockResolvedValue({ action: { sourceGenesis: hash }, programId: hash, programDataHash: hash } as never);
  vi.mocked(solanaRelayRepo.transactions).mockResolvedValue([]);
  vi.mocked(solanaActionService.confirmationPlan).mockResolvedValue({ actionHash: hash, to: env.core, data: "0x12" } as never);
});
describe("SOL authorization relay completion", () => {
  it("retries unavailable Wormhole proofs promptly without increasing failure backoff", async () => {
    vi.mocked(solanaRelayConfig).mockResolvedValue(config);
    vi.mocked(solanaRelayRepo.claim).mockResolvedValueOnce({ action: { ...action, failures: 3 }, lease: "lease" } as never);
    vi.mocked(solanaRelayRepo.claim).mockResolvedValue(null);
    vi.mocked(solanaActionService.confirmationPlan).mockRejectedValue(new Error("solana-proof-unavailable"));
    await expect(runSolanaRelayWorker()).resolves.toBe(1);
    expect(solanaRelayRepo.release).toHaveBeenCalledWith(hash, "lease", undefined, 3, 5000);
    expect(keeperTransaction).not.toHaveBeenCalled();
    expect(solanaRelayRepo.sourced).not.toHaveBeenCalled();
    expect(solanaRelayRepo.completed).not.toHaveBeenCalled();
  });
  it("resumes a finalized source transfer without repeating custody execution", async () => {
    vi.mocked(keeperTransaction).mockResolvedValue("pending");
    await processSolanaRelay(action, "lease", config);
    expect(solanaRelayRepo.sourced).not.toHaveBeenCalled();
    expect(solanaRelayRepo.completed).not.toHaveBeenCalled();
    vi.mocked(keeperTransaction).mockResolvedValue("success");
    await processSolanaRelay(action, "lease", config);
    expect(solanaRelayRepo.completed).toHaveBeenCalledWith(hash, "lease");
    expect(solanaActionService.confirmationPlan).toHaveBeenCalledWith({ creditId: hash, kind: "release", mode: "apply", sourceTx: action.sourceTx });
  });
  it("confirms an owner-funded top-up using its durable source checkpoint", async () => {
    vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 143, getBlock: async () => ({ number: 10n }),
      readContract: async () => [10n, hash, 2n, 1000n] } as never);
    vi.mocked(keeperTransaction).mockResolvedValue("success");
    await processSolanaRelay({ ...action, kind: 2 }, "lease", config);
    expect(solanaRelayRepo.sourced).not.toHaveBeenCalled();
    expect(solanaActionService.confirmationPlan).toHaveBeenCalledWith({ creditId: hash, kind: "topup", mode: "apply", sourceTx: action.sourceTx });
    expect(solanaRelayRepo.completed).toHaveBeenCalledWith(hash, "lease");
  });
  it("blocks new work while an earlier signed transaction is unresolved", async () => {
    vi.mocked(solanaRelayRepo.transactions).mockResolvedValue([{ _id: "signature" }] as never);
    vi.mocked(deliverSolanaRelay).mockResolvedValue("pending");
    await expect(processSolanaRelay(action, "lease", config)).rejects.toThrow("solana-relay-transaction-pending");
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("rejects substituted authorizations and confirmation plans", async () => {
    const other = `0x${"2".repeat(64)}` as Hex;
    await expect(processSolanaRelay({ ...action, _id: other }, "lease", config)).rejects.toThrow("solana-relay-authorization-changed");
    vi.mocked(solanaActionService.confirmationPlan).mockResolvedValue({ actionHash: other } as never);
    await expect(processSolanaRelay(action, "lease", config)).rejects.toThrow("solana-relay-confirmation-mismatch");
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
});
