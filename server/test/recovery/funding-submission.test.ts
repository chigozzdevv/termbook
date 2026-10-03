import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";

const mocks = vi.hoisted(() => ({
  source: {
    getChainId: vi.fn(), getBlock: vi.fn(), getTransactionReceipt: vi.fn(),
    sendRawTransaction: vi.fn(), getTransactionCount: vi.fn(), readContract: vi.fn(),
  },
  wallet: vi.fn(),
  funder: { address: `0x${"11".repeat(20)}` },
}));

vi.mock("../../src/chain/keeper-funding.js", () => ({ assertKeeperFunding: vi.fn(), assertSignedKeeperFunding: vi.fn() }));
vi.mock("viem", async (load) => ({
  ...await load<typeof import("viem")>(),
  createPublicClient: vi.fn(() => mocks.source),
  createWalletClient: mocks.wallet,
}));
vi.mock("../../src/recovery/recovery.config.js", () => ({ recoveryConfig: () => ({
  sourceRpcs: { 1: "http://127.0.0.1:8545" }, funder: mocks.funder,
}) }));
vi.mock("../../src/recovery/recovery.plan.js", async (load) => ({
  ...await load<typeof import("../../src/recovery/recovery.plan.js")>(),
  recoveryFundingPlan: vi.fn(() => ({
    operation: {
      operationId: `0x${"22".repeat(32)}`, sourceChain: 1,
      sourceRefundRecipient: `0x${"33".repeat(20)}`,
    },
    record: { operationId: `0x${"22".repeat(32)}` },
    funding: { operationId: `0x${"22".repeat(32)}`, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) },
    digest: `0x${"44".repeat(32)}`,
  })),
}));

import { env } from "../../src/config/env.js";
import { logger } from "../../src/logging/logger.js";
import { recoveryRepo } from "../../src/recovery/recovery.repo.js";
import { runRecoveryWorker } from "../../src/recovery/recovery.worker.js";
import { SettlementModel } from "../../src/settlement/settlement.model.js";

const operationId = `0x${"22".repeat(32)}`;
const rawTx = "0x1234";
const hash = keccak256(rawTx);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("durable recovery funding", () => {
  it("replays the persisted signed transaction after a worker restart", async () => {
    env.core = `0x${"55".repeat(20)}`;
    env.settlementFactory = `0x${"66".repeat(20)}`;
    mocks.source.getChainId.mockResolvedValue(1);
    mocks.source.getBlock.mockResolvedValue({ number: 100n, timestamp: BigInt(Math.floor(Date.now() / 1000)) });
    mocks.source.getTransactionReceipt.mockRejectedValue(new Error("not found"));
    mocks.source.sendRawTransaction.mockResolvedValue(hash);
    mocks.source.getTransactionCount.mockResolvedValue(7);
    vi.spyOn(SettlementModel, "aggregate").mockResolvedValue([{ operationId }]);
    vi.spyOn(recoveryRepo, "claim").mockResolvedValue({
      token: "lease", state: "prepared", fundingTxHash: hash, fundingRawTx: rawTx,
      fundingNonce: 7, fundingFunder: mocks.funder.address,
    });
    vi.spyOn(recoveryRepo, "acquireFunder").mockResolvedValue(true);
    const submitted = vi.spyOn(recoveryRepo, "markSubmitted").mockResolvedValue({ matchedCount: 1 } as never);
    const released = vi.spyOn(recoveryRepo, "release").mockResolvedValue();
    const updated = vi.spyOn(recoveryRepo, "update").mockResolvedValue();
    vi.spyOn(logger, "warn").mockImplementation(() => {});

    expect(await runRecoveryWorker()).toBe(0);
    expect(mocks.source.sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: rawTx });
    expect(submitted).toHaveBeenCalledWith(operationId, "lease");
    expect(released).toHaveBeenCalledWith(operationId, "lease");
    expect(updated).not.toHaveBeenCalled();
    expect(mocks.wallet).not.toHaveBeenCalled();
  });

  it("retires a legacy submission with no hash after finalized source expiry", async () => {
    env.core = `0x${"55".repeat(20)}`;
    env.settlementFactory = `0x${"66".repeat(20)}`;
    mocks.source.getChainId.mockResolvedValue(1);
    mocks.source.getBlock.mockResolvedValue({ number: 100n, timestamp: BigInt(Math.floor(Date.now() / 1000) + 1_000) });
    mocks.source.readContract.mockResolvedValue(false);
    vi.spyOn(SettlementModel, "aggregate").mockResolvedValue([{ operationId }]);
    vi.spyOn(recoveryRepo, "claim").mockResolvedValue({
      token: "lease", state: "submitting", fundingFunder: mocks.funder.address,
    });
    const updated = vi.spyOn(recoveryRepo, "update").mockResolvedValue();
    const unlocked = vi.spyOn(recoveryRepo, "releaseFunder").mockResolvedValue();
    vi.spyOn(logger, "warn").mockImplementation(() => {});

    expect(await runRecoveryWorker()).toBe(1);
    expect(updated).toHaveBeenCalledWith(operationId, "lease", "expired", {
      failure: "recovery-signed-transaction-missing",
    });
    expect(unlocked).toHaveBeenCalledWith(1, mocks.funder.address, operationId);
    expect(mocks.source.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("does not broadcast an unmined signed tx after finalized source expiry", async () => {
    env.core = `0x${"55".repeat(20)}`;
    env.settlementFactory = `0x${"66".repeat(20)}`;
    mocks.source.getChainId.mockResolvedValue(1);
    mocks.source.getBlock.mockResolvedValue({ number: 100n, timestamp: BigInt(Math.floor(Date.now() / 1000) + 1_000) });
    mocks.source.getTransactionReceipt.mockRejectedValue(new Error("not found"));
    mocks.source.readContract.mockResolvedValue(false);
    vi.spyOn(SettlementModel, "aggregate").mockResolvedValue([{ operationId }]);
    vi.spyOn(recoveryRepo, "claim").mockResolvedValue({
      token: "lease", state: "prepared", fundingTxHash: hash, fundingRawTx: rawTx,
      fundingNonce: 7, fundingFunder: mocks.funder.address,
    });
    vi.spyOn(recoveryRepo, "acquireFunder").mockResolvedValue(true);
    const updated = vi.spyOn(recoveryRepo, "update").mockResolvedValue();
    const unlocked = vi.spyOn(recoveryRepo, "releaseFunder").mockResolvedValue();
    vi.spyOn(logger, "warn").mockImplementation(() => {});

    expect(await runRecoveryWorker()).toBe(1);
    expect(updated).toHaveBeenCalledWith(operationId, "lease", "expired", {
      failure: "recovery-funding-deadline-expired",
    });
    expect(unlocked).toHaveBeenCalledWith(1, mocks.funder.address, operationId);
    expect(mocks.source.sendRawTransaction).not.toHaveBeenCalled();
  });
});
