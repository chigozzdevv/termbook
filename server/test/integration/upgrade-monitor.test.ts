import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadClient } from "../../src/chain/monad.client.js";
import { keeperTransaction, reconcileKeeperWallet } from "../../src/chain/keeper.js";
import { env } from "../../src/config/env.js";
import { runUpgradeMonitorWorker, upgradeMonitorConfig } from "../../src/integration/upgrade-monitor.worker.js";
import { proxyImplementationSlots } from "@termbook/schema";
import { approvedRuntimeReviews } from "../../src/integration/runtime-review.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn(), reconcileKeeperWallet: vi.fn() }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 10143, rpcUrl: "http://monad" } }));
vi.mock("../../src/logging/logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../src/integration/runtime-review.js", () => ({ approvedRuntimeReviews: vi.fn() }));
const guard = `0x${"11".repeat(20)}` as const;
const proxy = `0x${"22".repeat(20)}` as const;
const implementation = `0x${"33".repeat(20)}` as const;
const key = `0x${"44".repeat(32)}` as const;
const signer = privateKeyToAccount(key).address;
const codeHash = keccak256("0x1234");
const readContract = vi.fn(), getStorageAt = vi.fn(), getCode = vi.fn(), simulateContract = vi.fn();
const multicall = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(approvedRuntimeReviews).mockResolvedValue([]);
  env.monadChainId = 10143;
  vi.stubEnv("TESTNET_UPGRADE_GUARDS", JSON.stringify([{ address: guard, codeHash }]));
  vi.stubEnv("UPGRADE_MONITOR_KEY", key);
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => ({
    proxy, implementation, monitor: signer, proxyCodeHash: codeHash, implementationCodeHash: codeHash,
    validUntil: 0n, observedBlock: 0n, revoked: false,
  })[functionName as "proxy"]);
  getStorageAt.mockImplementation(async ({ slot }: { slot: string }) => slot === proxyImplementationSlots[0]
    ? `0x${"0".repeat(24)}${implementation.slice(2)}` : `0x${"0".repeat(64)}`);
  getCode.mockResolvedValue("0x1234");
  multicall.mockImplementation(async ({ contracts }: { contracts: { address: string; functionName: string }[] }) => Promise.all(contracts.map((request) => readContract(request))));
  vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 10143,
    getBlock: async ({ blockTag }: { blockTag: string }) => ({ number: blockTag === "finalized" ? 10n : 12n,
      timestamp: blockTag === "finalized" ? 1000n : 1001n, hash: codeHash }),
    getCode, getStorageAt, readContract, multicall, simulateContract } as never);
  vi.mocked(keeperTransaction).mockResolvedValue("success");
  vi.mocked(reconcileKeeperWallet).mockResolvedValue("idle");
});
afterEach(() => { env.monadChainId = 10143; vi.unstubAllEnvs(); });

describe("testnet upgrade monitor", () => {
  it("settles an outstanding renewal before preparing another nonce", async () => {
    vi.mocked(reconcileKeeperWallet).mockResolvedValueOnce("pending").mockResolvedValueOnce("success");
    expect(await runUpgradeMonitorWorker()).toBe(0);
    expect(getCode).not.toHaveBeenCalled();
    expect(keeperTransaction).not.toHaveBeenCalled();
    expect(await runUpgradeMonitorWorker()).toBe(1);
    expect(reconcileKeeperWallet).toHaveBeenCalledWith(monadClient(), 10143, signer);
  });
  it("prioritizes expired guards when only one renewal can be submitted", async () => {
    const expired = `0x${"55".repeat(20)}` as const;
    vi.stubEnv("TESTNET_UPGRADE_GUARDS", JSON.stringify([{ address: guard, codeHash }, { address: expired, codeHash }]));
    const original = readContract.getMockImplementation()!;
    readContract.mockImplementation(async (request) => request.functionName === "validUntil"
      ? request.address === expired ? 0n : 1050n : original(request));
    vi.mocked(keeperTransaction).mockResolvedValueOnce("pending").mockResolvedValue("busy");
    expect(await runUpgradeMonitorWorker()).toBe(0);
    expect(vi.mocked(keeperTransaction).mock.calls[0]![0].to).toBe(expired);
    expect(keeperTransaction).toHaveBeenCalledTimes(1);
    expect(getCode).not.toHaveBeenCalledWith(expect.objectContaining({ address: guard }));
  });
  it("revokes a review-bound guard when its signed permit is removed", async () => {
    vi.stubEnv("TESTNET_UPGRADE_GUARDS", JSON.stringify([{ address: guard, codeHash, runtimeReview: codeHash }]));
    expect(await runUpgradeMonitorWorker()).toBe(1);
    expect(vi.mocked(keeperTransaction).mock.calls[0]![0].operation).toBe(`upgrade-revoke:${guard}`);
  });
  it("revokes an expired runtime review even while the guard lease is current", async () => {
    const original = readContract.getMockImplementation()!;
    readContract.mockImplementation(async (request) => request.functionName === "validUntil" ? 1100n : original(request));
    vi.mocked(approvedRuntimeReviews).mockResolvedValue([{ target: proxy, implementation, code_hash: codeHash, expires_at: 1000 } as never]);
    expect(await runUpgradeMonitorWorker()).toBe(1);
    expect(vi.mocked(keeperTransaction).mock.calls[0]![0].operation).toBe(`upgrade-revoke:${guard}`);
  });
  it("renews against a finalized canonical block after checking both storage views", async () => {
    expect(await runUpgradeMonitorWorker()).toBe(1);
    expect(getStorageAt).toHaveBeenCalledWith(expect.objectContaining({ address: proxy, blockNumber: 10n }));
    expect(getStorageAt).toHaveBeenCalledWith(expect.objectContaining({ address: proxy, blockNumber: 12n }));
    expect(multicall).toHaveBeenCalledWith(expect.objectContaining({ allowFailure: false,
      contracts: expect.arrayContaining([expect.objectContaining({ address: guard, functionName: "validUntil" })]) }));
    const data = vi.mocked(keeperTransaction).mock.calls[0]![0].data;
    expect(decodeFunctionData({ abi: parseAbi(["function renew(uint64,bytes32,uint64)"]), data }).args).toEqual([10n, codeHash, 1000n]);
  });
  it("accepts a finalized head equal to the latest head", async () => {
    const client = vi.mocked(monadClient).mock.results[0]?.value ?? monadClient();
    client.getBlock = vi.fn().mockResolvedValue({ number: 10n, timestamp: 1000n, hash: codeHash });
    expect(await runUpgradeMonitorWorker()).toBe(1);
  });
  it("permanently revokes when the latest view detects an upgrade before finality", async () => {
    getStorageAt.mockImplementation(async ({ blockNumber, slot }: { blockNumber: bigint; slot: string }) => slot !== proxyImplementationSlots[0]
      ? `0x${"0".repeat(64)}` : blockNumber === 12n ? `0x${"0".repeat(24)}${proxy.slice(2)}` : `0x${"0".repeat(24)}${implementation.slice(2)}`);
    expect(await runUpgradeMonitorWorker()).toBe(1);
    expect(vi.mocked(keeperTransaction).mock.calls[0]![0].operation).toBe(`upgrade-revoke:${guard}`);
  });
  it("checks and revokes a legacy OpenZeppelin proxy when its implementation changes", async () => {
    getStorageAt.mockImplementation(async ({ blockNumber, slot }: { blockNumber: bigint; slot: string }) => slot !== proxyImplementationSlots[1]
      ? `0x${"0".repeat(64)}` : `0x${"0".repeat(24)}${(blockNumber === 12n ? proxy : implementation).slice(2)}`);
    expect(await runUpgradeMonitorWorker()).toBe(1);
    expect(vi.mocked(keeperTransaction).mock.calls[0]![0].operation).toBe(`upgrade-revoke:${guard}`);
  });
  it("allows approval to expire when RPC reads fail", async () => {
    getStorageAt.mockRejectedValue(new Error("RPC failed"));
    expect(await runUpgradeMonitorWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("does not renew a revoked guard or a lease with more than two minutes remaining", async () => {
    const original = readContract.getMockImplementation()!;
    readContract.mockImplementation(async (request) => request.functionName === "revoked" ? true : original(request));
    expect(await runUpgradeMonitorWorker()).toBe(0);
    readContract.mockImplementation(async (request) => request.functionName === "validUntil" ? 1200n : original(request));
    expect(await runUpgradeMonitorWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("rejects changed guard code, wrong monitor and malformed slot data", async () => {
    getCode.mockResolvedValueOnce("0x5678");
    expect(await runUpgradeMonitorWorker()).toBe(0);
    const original = readContract.getMockImplementation()!;
    readContract.mockImplementation(async (request) => request.functionName === "monitor" ? proxy : original(request));
    expect(await runUpgradeMonitorWorker()).toBe(0);
    readContract.mockImplementation(original);
    getStorageAt.mockResolvedValue("0x01");
    expect(await runUpgradeMonitorWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("rejects mainnet configuration, duplicate guards and a shared keeper key", () => {
    env.monadChainId = 143;
    expect(upgradeMonitorConfig).toThrow("upgrade-monitor-config-invalid");
    env.monadChainId = 10143;
    vi.stubEnv("TESTNET_UPGRADE_GUARDS", JSON.stringify([{ address: guard, codeHash }, { address: guard, codeHash }]));
    expect(upgradeMonitorConfig).toThrow("upgrade-monitor-config-invalid");
    vi.stubEnv("TESTNET_UPGRADE_GUARDS", JSON.stringify([{ address: guard, codeHash }]));
    vi.stubEnv("RISK_KEEPER_KEY", key);
    expect(upgradeMonitorConfig).toThrow("upgrade-monitor-key-conflict");
  });
});
