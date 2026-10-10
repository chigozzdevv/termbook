import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadClient } from "../../src/chain/monad.client.js";
import { keeperTransaction } from "../../src/chain/keeper.js";
import { env } from "../../src/config/env.js";
import { runUpgradeMonitorWorker, upgradeMonitorConfig } from "../../src/integration/upgrade-monitor.worker.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn() }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 10143, rpcUrl: "http://monad" } }));
vi.mock("../../src/logging/logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
const guard = `0x${"11".repeat(20)}` as const;
const proxy = `0x${"22".repeat(20)}` as const;
const implementation = `0x${"33".repeat(20)}` as const;
const key = `0x${"44".repeat(32)}` as const;
const signer = privateKeyToAccount(key).address;
const codeHash = keccak256("0x1234");
const readContract = vi.fn(), getStorageAt = vi.fn(), getCode = vi.fn(), simulateContract = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  env.monadChainId = 10143;
  vi.stubEnv("TESTNET_UPGRADE_GUARDS", JSON.stringify([{ address: guard, codeHash }]));
  vi.stubEnv("UPGRADE_MONITOR_KEY", key);
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => ({
    proxy, implementation, monitor: signer, proxyCodeHash: codeHash, implementationCodeHash: codeHash,
    validUntil: 0n, observedBlock: 0n, revoked: false,
  })[functionName as "proxy"]);
  getStorageAt.mockResolvedValue(`0x${"0".repeat(24)}${implementation.slice(2)}`);
  getCode.mockResolvedValue("0x1234");
  vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 10143,
    getBlock: async ({ blockTag }: { blockTag: string }) => ({ number: blockTag === "finalized" ? 10n : 12n,
      timestamp: blockTag === "finalized" ? 1000n : 1001n, hash: codeHash }),
    getCode, getStorageAt, readContract, simulateContract } as never);
  vi.mocked(keeperTransaction).mockResolvedValue("success");
});
afterEach(() => { env.monadChainId = 10143; vi.unstubAllEnvs(); });

describe("testnet upgrade monitor", () => {
  it("renews against a finalized canonical block after checking both storage views", async () => {
    expect(await runUpgradeMonitorWorker()).toBe(1);
    expect(getStorageAt).toHaveBeenCalledWith(expect.objectContaining({ address: proxy, blockNumber: 10n }));
    expect(getStorageAt).toHaveBeenCalledWith(expect.objectContaining({ address: proxy, blockNumber: 12n }));
    const data = vi.mocked(keeperTransaction).mock.calls[0]![0].data;
    expect(decodeFunctionData({ abi: parseAbi(["function renew(uint64,bytes32,uint64)"]), data }).args).toEqual([10n, codeHash, 1000n]);
  });
  it("permanently revokes when the latest view detects an upgrade before finality", async () => {
    getStorageAt.mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => blockNumber === 12n
      ? `0x${"0".repeat(24)}${proxy.slice(2)}` : `0x${"0".repeat(24)}${implementation.slice(2)}`);
    expect(await runUpgradeMonitorWorker()).toBe(1);
    expect(vi.mocked(keeperTransaction).mock.calls[0]![0].operation).toBe(`upgrade-revoke:${guard}`);
  });
  it("allows approval to expire when RPC reads fail", async () => {
    getStorageAt.mockRejectedValue(new Error("RPC failed"));
    expect(await runUpgradeMonitorWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("does not renew a revoked guard or a lease with more than a minute remaining", async () => {
    const original = readContract.getMockImplementation()!;
    readContract.mockImplementation(async (request) => request.functionName === "revoked" ? true : original(request));
    expect(await runUpgradeMonitorWorker()).toBe(0);
    readContract.mockImplementation(async (request) => request.functionName === "validUntil" ? 1100n : original(request));
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
