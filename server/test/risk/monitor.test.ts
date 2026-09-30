import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRiskWorker } from "../../src/risk/risk.worker.js";
import { riskRepo } from "../../src/risk/risk.repo.js";
import { keeperTransaction } from "../../src/chain/keeper.js";

const mocks = vi.hoisted(() => ({ read: vi.fn(), simulate: vi.fn(), call: vi.fn(), keeper: { address: `0x${"1".repeat(40)}` } }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 143,
  core: `0x${"2".repeat(40)}`, rpcUrl: "http://127.0.0.1" } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => ({
  getChainId: async () => 143, getBlock: async () => ({ number: 100n, hash: `0x${"b".repeat(64)}`, timestamp: 1000n }),
  readContract: mocks.read, simulateContract: mocks.simulate, call: mocks.call,
}) }));
vi.mock("../../src/risk/risk.config.js", () => ({ riskKeeper: () => mocks.keeper, riskScanConfig: () => ({ shards: 1, pageSize: 128, concurrency: 8, maxAgeMs: 120000 }) }));
vi.mock("../../src/risk/risk.repo.js", () => ({ riskRepo: { page: vi.fn(), advance: vi.fn(), record: vi.fn(), claim: vi.fn(), renew: vi.fn(), release: vi.fn() } }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn() }));
vi.mock("../../src/recovery/clearance.service.js", () => ({ recoveryClearancePlan: vi.fn() }));
const id = `0x${"a".repeat(64)}`;
let credit: Record<string, unknown>;
let health: bigint;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(riskRepo.claim).mockResolvedValue({ id: "scan", lease: "token", lower: "", upper: null, after: "", cycleStartedAt: new Date(), cycleCompletedAt: new Date() });
  vi.mocked(riskRepo.renew).mockResolvedValue(true);
  health = 10500n;
  credit = { facility: 4, payment: 1, debt: 200n, revision: 4n, maturity: 2000n, grace: 100n,
    bundleId: id, account: mocks.keeper.address };
  vi.mocked(riskRepo.page).mockResolvedValue([id]);
  vi.mocked(keeperTransaction).mockResolvedValue("pending");
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (functionName === "creditDetails") return credit;
    if (functionName === "recoveryKeepers") return true;
    if (["riskEngine", "healthSource"].includes(functionName)) return mocks.keeper.address;
    if (functionName === "previewHealth") return { debt: 200n, healthBps: health };
    if (functionName === "creditDebt") return 200n;
    if (functionName === "liquidationBps") return 11000n;
    if (functionName === "freezeBps") return 11500n;
    if (functionName === "watchBps") return 12000n;
    throw new Error("unexpected-read");
  });
});

describe("continuous risk monitoring", () => {
  it("uses current finalized state and simulates eligibility before submitting liquidation", async () => {
    expect(await runRiskWorker()).toBe(1);
    expect(mocks.simulate).toHaveBeenCalledWith(expect.objectContaining({ functionName: "startLiquidation", blockNumber: 100n }));
    expect(keeperTransaction).toHaveBeenCalledWith(expect.objectContaining({ operation: `${id}:4:startLiquidation` }));
    expect(riskRepo.record).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: "liquidatable" }));
    expect(mocks.read.mock.calls.every(([arg]) => arg.blockNumber === 100n)).toBe(true);
  });

  it("does not liquidate healthy or unavailable state", async () => {
    health = 15000n;
    await runRiskWorker();
    expect(keeperTransaction).not.toHaveBeenCalled();
    mocks.read.mockImplementation(async () => { throw new Error("rpc-unavailable"); });
    await expect(runRiskWorker()).rejects.toThrow("rpc-unavailable");
    expect(keeperTransaction).not.toHaveBeenCalled();
  });

  it("records unavailable health and never substitutes cached backing", async () => {
    mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "creditDetails") return credit;
      if (functionName === "recoveryKeepers") return true;
      throw new Error("stale-oracle");
    });
    await runRiskWorker();
    expect(keeperTransaction).not.toHaveBeenCalled();
    expect(riskRepo.record).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: "unavailable" }));
  });

  it("marks grace-expired debt defaulted before its recovery transition", async () => {
    credit["maturity"] = 500n;
    await runRiskWorker();
    expect(mocks.simulate).toHaveBeenCalledWith(expect.objectContaining({ functionName: "markDefaulted" }));
    expect(keeperTransaction).toHaveBeenCalledTimes(1);
  });

  it("compares preview health against accrued debt rather than the stored principal", async () => {
    credit["debt"] = 190n;
    await runRiskWorker();
    expect(mocks.simulate).toHaveBeenCalledWith(expect.objectContaining({ functionName: "startLiquidation" }));
    expect(riskRepo.record).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ debt: "200" }));
  });

  it("authorizes source seizure only after the app has exited and account cash has been reconciled", async () => {
    credit = { ...credit, facility: 9, collateralAmount: 300n, vault: mocks.keeper.address };
    mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => ({
      creditDetails: credit, recoveryKeepers: true, creditFreeCash: 0n, fullTermination: true,
      exitVerifierOfBundle: mocks.keeper.address, canExit: true, remoteCollateral: true,
      pendingRemoteSeizure: 0n, solanaCollateral: false, ethereumWormholeCore: mocks.keeper.address,
      messageFee: 10n,
    })[functionName]);
    await runRiskWorker();
    expect(keeperTransaction).toHaveBeenCalledWith(expect.objectContaining({
      operation: `${id}:4:seize`, value: 10n,
    }));
    expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 100n, value: 10n }));
    expect(riskRepo.record).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: "source_seizure_required" }));
  });
});
