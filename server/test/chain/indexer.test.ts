import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { runIndexerWorker } from "../../src/chain/indexer.worker.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { indexerRepo } from "../../src/chain/indexer.repo.js";
import { creditService } from "../../src/credit/credit.service.js";
import { queue } from "../../src/queue/queue.client.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/indexer.repo.js", () => ({ indexerRepo: {
  claim: vi.fn(), renew: vi.fn(), record: vi.fn(), advance: vi.fn(), integrityFailure: vi.fn(), release: vi.fn(),
} }));
vi.mock("../../src/credit/credit.service.js", () => ({ creditService: { refresh: vi.fn() } }));
vi.mock("../../src/queue/queue.client.js", () => ({ queue: { push: vi.fn() } }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 143, core: `0x${"1".repeat(40)}` } }));
const word = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const creditId = word("a");
const address = `0x${"2".repeat(40)}` as `0x${string}`;
const event = parseAbi(["event CreditCreated(bytes32 indexed creditId,bytes32 indexed intentId,address borrower,address house)"]);
let calls: string[];
const getLogs = vi.fn();
const getBlock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  calls = [];
  vi.mocked(indexerRepo.claim).mockResolvedValue({ nextBlock: "1", lease: "lease" });
  vi.mocked(indexerRepo.renew).mockResolvedValue(true);
  vi.mocked(indexerRepo.record).mockImplementation(async () => { calls.push("record"); });
  vi.mocked(creditService.refresh).mockImplementation(async () => { calls.push("refresh"); return null; });
  vi.mocked(queue.push).mockImplementation(async () => { calls.push("queue"); });
  vi.mocked(indexerRepo.advance).mockImplementation(async () => { calls.push("advance"); });
  getBlock.mockImplementation(async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber ?? 2n, hash: word("b") }));
  getLogs.mockResolvedValue([{ blockNumber: 2n, blockHash: word("b"), transactionHash: word("c"), logIndex: 0,
    removed: false, data: encodeAbiParameters([{ type: "address" }, { type: "address" }], [address, address]),
    topics: encodeEventTopics({ abi: event, eventName: "CreditCreated", args: { creditId, intentId: word("d") } }) }]);
  vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 143, getBlock, getLogs } as never);
});

describe("durable finalized Core index", () => {
  it("checkpoints only after canonical events, credit state, and durable refresh jobs", async () => {
    expect(await runIndexerWorker(1n)).toBe(1);
    expect(calls).toEqual(["record", "refresh", "queue", "advance"]);
    expect(indexerRepo.advance).toHaveBeenCalledWith(expect.any(String), "lease", 3n, word("b"));
    expect(creditService.refresh).toHaveBeenCalledWith(creditId);
  });

  it("replays the same event identity after a delivery failure without advancing", async () => {
    vi.mocked(queue.push).mockRejectedValueOnce(new Error("durable-queue-unavailable"));
    await expect(runIndexerWorker(1n)).rejects.toThrow("durable-queue-unavailable");
    expect(indexerRepo.advance).not.toHaveBeenCalled();
    const firstId = vi.mocked(indexerRepo.record).mock.calls[0]![0];
    await runIndexerWorker(1n);
    expect(vi.mocked(indexerRepo.record).mock.calls[1]![0]).toBe(firstId);
    expect(indexerRepo.release).toHaveBeenCalledTimes(2);
  });

  it("halts the cursor when an already indexed finalized block changes", async () => {
    vi.mocked(indexerRepo.claim).mockResolvedValue({ nextBlock: "2", lease: "lease", lastBlockHash: word("e") });
    await expect(runIndexerWorker(1n)).rejects.toThrow("indexer-finalized-block-changed");
    expect(indexerRepo.integrityFailure).toHaveBeenCalled();
    expect(getLogs).not.toHaveBeenCalled();
    expect(indexerRepo.advance).not.toHaveBeenCalled();
  });

  it("never checkpoints an RPC gap or noncanonical event", async () => {
    getLogs.mockRejectedValueOnce(new Error("rpc-gap"));
    await expect(runIndexerWorker(1n)).rejects.toThrow("rpc-gap");
    expect(indexerRepo.advance).not.toHaveBeenCalled();
    getBlock.mockResolvedValue({ number: 2n, hash: word("e") });
    await expect(runIndexerWorker(1n)).rejects.toThrow("indexer-log-not-canonical");
    expect(indexerRepo.record).not.toHaveBeenCalled();
  });
});
