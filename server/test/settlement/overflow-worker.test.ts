import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { env } from "../../src/config/env.js";
import { logger } from "../../src/logging/logger.js";
import { SettlementModel } from "../../src/settlement/settlement.model.js";
import { runSettlementWorker } from "../../src/settlement/settlement.worker.js";

const mocks = vi.hoisted(() => ({
  chain: {
    getChainId: vi.fn(), readContract: vi.fn(), call: vi.fn(), waitForTransactionReceipt: vi.fn(),
  },
  wallet: { sendTransaction: vi.fn() },
}));

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => mocks.chain }));
vi.mock("viem", async (load) => ({
  ...await load<typeof import("viem")>(),
  createWalletClient: vi.fn(() => mocks.wallet),
}));

const inbox = `0x${"1".repeat(40)}`;
const vault = `0x${"2".repeat(40)}`;
const token = `0x${"3".repeat(40)}`;
const core = `0x${"4".repeat(40)}`;
const creditId = `0x${"5".repeat(64)}`;
const operationId = `0x${"6".repeat(64)}`;
const txHash = `0x${"7".repeat(64)}`;
const original = {
  monadChainId: env.monadChainId, settlementFactory: env.settlementFactory,
  settlementKeeperKey: env.settlementKeeperKey, rpcUrl: env.rpcUrl,
};
const inboxAbi = parseAbi([
  "function notifyReceipt(uint256 amount)",
  "function settle(uint256 amount)",
  "function refundUntracked(uint256 amount)",
]);

function setup(received: bigint, applied: bigint, balance: bigint, debt: bigint, providerStatus?: string) {
  env.monadChainId = 143;
  env.settlementFactory = `0x${"8".repeat(40)}`;
  env.settlementKeeperKey = `0x${"1".repeat(64)}`;
  env.rpcUrl = "http://127.0.0.1:8545";
  const deadline = Math.floor(Date.now() / 1000) - (providerStatus ? 1_200 : 60);
  vi.spyOn(SettlementModel, "find").mockReturnValue({
    sort: () => ({ limit: () => ({ lean: async () => [{
      operationId, inbox, vault, token, creditId, kind: "recovery", deadline,
      minAmountOut: "80", maxReceived: "100", providerStatus,
      providerStatusCheckedAt: Date.now(),
    }] }) }),
  } as never);
  vi.spyOn(SettlementModel, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
  mocks.chain.getChainId.mockResolvedValue(143);
  mocks.chain.call.mockResolvedValue({});
  mocks.chain.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  mocks.wallet.sendTransaction.mockResolvedValue(txHash);
  mocks.chain.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => ({
    inboxOf: inbox, vault, token, creditId, deadline: BigInt(deadline), minOut: 80n,
    maxReceived: 100n, received, applied, refunded: 0n, settlementInboxes: true,
    balanceOf: balance, core, creditDebt: debt,
  } as Record<string, unknown>)[functionName]);
}

afterEach(() => {
  env.monadChainId = original.monadChainId;
  env.settlementFactory = original.settlementFactory;
  env.settlementKeeperKey = original.settlementKeeperKey;
  env.rpcUrl = original.rpcUrl;
  vi.restoreAllMocks();
  Object.values(mocks.chain).forEach((mock) => mock.mockReset());
  mocks.wallet.sendTransaction.mockReset();
});

describe("recovery inbox overflow", () => {
  it("notifies only the remaining cap when a delivery exceeds it", async () => {
    setup(0n, 0n, 101n, 100n);
    expect(await runSettlementWorker()).toBe(1);
    const data = mocks.chain.call.mock.calls[0]![0].data;
    const decoded = decodeFunctionData({ abi: inboxAbi, data });
    expect(decoded.functionName).toBe("notifyReceipt");
    expect(decoded.args[0]).toBe(100n);
  });

  it("settles tracked debt without refunding the excess", async () => {
    setup(100n, 0n, 101n, 80n);
    expect(await runSettlementWorker()).toBe(1);
    const data = mocks.chain.call.mock.calls[0]![0].data;
    const decoded = decodeFunctionData({ abi: inboxAbi, data });
    expect(decoded.functionName).toBe("settle");
    expect(decoded.args[0]).toBe(80n);
  });

  it("holds untracked proceeds while debt remains", async () => {
    setup(100n, 100n, 1n, 20n);
    expect(await runSettlementWorker()).toBe(0);
    expect(mocks.chain.call).not.toHaveBeenCalled();
  });

  it("records and alerts on a terminal recovery delivery below the quoted floor", async () => {
    setup(40n, 40n, 0n, 60n, "SUCCESS");
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(await runSettlementWorker()).toBe(0);
    expect(SettlementModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ operationId, recoveryShortfall: { $ne: "40" } }),
      expect.objectContaining({ $set: expect.objectContaining({ recoveryShortfall: "40" }) }),
    );
    expect(warning).toHaveBeenCalledWith("recovery-proceeds-shortfall", expect.objectContaining({
      operationId, minimum: "80", realized: "40", shortfall: "40",
    }));
  });

  it("counts creditable tokens already at the inbox before raising a shortfall", async () => {
    setup(0n, 0n, 101n, 100n, "SUCCESS");
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(await runSettlementWorker()).toBe(1);
    expect(warning).not.toHaveBeenCalledWith("recovery-proceeds-shortfall", expect.anything());
  });
});
