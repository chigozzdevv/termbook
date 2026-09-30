import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingAccountingEqual, runExecutionWorker } from "../../src/integration/execution.worker.js";
import { keeperTransaction } from "../../src/chain/keeper.js";
import { riskRepo } from "../../src/risk/risk.repo.js";

const mocks = vi.hoisted(() => ({ read: vi.fn(), simulate: vi.fn(), keeper: { address: `0x${"1".repeat(40)}` } }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 143,
  core: `0x${"2".repeat(40)}`, rpcUrl: "http://localhost" } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => ({
  getChainId: async () => 143, getBlock: async () => ({ number: 100n }),
  readContract: mocks.read, simulateContract: mocks.simulate,
}) }));
vi.mock("../../src/risk/risk.config.js", () => ({ riskKeeper: () => mocks.keeper, riskScanConfig: () => ({ shards: 1, pageSize: 128, concurrency: 8, maxAgeMs: 120000 }) }));
vi.mock("../../src/risk/risk.repo.js", () => ({ riskRepo: { page: vi.fn(), advance: vi.fn(), claim: vi.fn(), renew: vi.fn(), release: vi.fn() } }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn(async () => "confirmed") }));
vi.mock("../../src/logging/logger.js", () => ({ logger: { warn: vi.fn() } }));
const id = `0x${"3".repeat(64)}`;
let changed = true;
let blocked = false;
let breached = false;
let health = 15_000n;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(riskRepo.claim).mockResolvedValue({ id: "scan", lease: "token", lower: "", upper: null, after: "" });
  vi.mocked(riskRepo.renew).mockResolvedValue(true);
  changed = true; blocked = false; breached = false; health = 15_000n;
  vi.mocked(riskRepo.page).mockResolvedValue([id]);
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
    const state = { filled: 0n, remaining: 100n, liability: 100n, observedAt: 999n };
    const values: Record<string, unknown> = {
      creditDetails: { facility: 4, account: mocks.keeper.address, bundleId: id, revision: 4n },
      managedBundle: true, executionManager: mocks.keeper.address, actionHealthBlocked: blocked,
      bundles: [mocks.keeper.address, mocks.keeper.address, id, id, id, 2, 2, 300], pendingCount: 1n,
      pendingAt: id, records: [id, id, 100n, 1, state],
      pendingState: changed ? { ...state, filled: 40n, remaining: 60n, liability: 60n } : { ...state, observedAt: 1000n },
      breached, riskEngine: mocks.keeper.address, initialBps: 15_000n, previewHealth: { healthBps: health },
    };
    if (!(functionName in values)) throw new Error(functionName);
    return values[functionName];
  });
});

describe("pending action monitor", () => {
  it("reconciles accounting changes at finalized state without requiring a health read", async () => {
    expect(await runExecutionWorker()).toBe(1);
    expect(keeperTransaction).toHaveBeenCalledWith(expect.objectContaining({ operation: `${id}:4:sync:100` }));
    expect(mocks.read.mock.calls.every(([arg]) => arg.blockNumber === 100n)).toBe(true);
    expect(mocks.read.mock.calls.some(([arg]) => arg.functionName === "previewHealth")).toBe(false);
    expect(riskRepo.advance).toHaveBeenCalledWith(expect.objectContaining({ id: "scan", lease: "token" }), id, "100", true);
  });
  it("does not pay for an observation timestamp alone", async () => {
    changed = false;
    await runExecutionWorker();
    expect(keeperTransaction).not.toHaveBeenCalled();
    expect(pendingAccountingEqual({ filled: 1n, observedAt: 1n }, { filled: 1n, observedAt: 2n })).toBe(true);
  });
  it("unblocks only verified healthy state and never a recorded bound breach", async () => {
    changed = false; blocked = true; health = 14_000n;
    await runExecutionWorker();
    expect(keeperTransaction).not.toHaveBeenCalled();
    health = 15_000n;
    await runExecutionWorker();
    expect(keeperTransaction).toHaveBeenCalledTimes(1);
    vi.mocked(keeperTransaction).mockClear(); breached = true;
    await runExecutionWorker();
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("does not submit an invalid authoritative transition", async () => {
    mocks.simulate.mockRejectedValueOnce(new Error("invalid-refund"));
    await runExecutionWorker();
    expect(keeperTransaction).not.toHaveBeenCalled();
    expect(riskRepo.advance).toHaveBeenCalled();
  });
});
