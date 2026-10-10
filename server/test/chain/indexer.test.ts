import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { runIndexerWorker } from "../../src/chain/indexer.worker.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { indexerRepo } from "../../src/chain/indexer.repo.js";
import { creditService } from "../../src/credit/credit.service.js";
import { queue } from "../../src/queue/queue.client.js";
import * as eventSource from "../../src/chain/envio.client.js";

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
afterEach(() => vi.restoreAllMocks());
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
  it("checkpoints only the completed Envio page, including pages with no matching events", async () => {
    getBlock.mockImplementation(async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber ?? 1000n, hash: word("b") }));
    vi.spyOn(eventSource, "readCoreEvents").mockResolvedValue({ logs: [], nextBlock: 201n, source: "envio" });
    await runIndexerWorker(1n);
    expect(indexerRepo.advance).toHaveBeenCalledWith(expect.any(String), "lease", 201n, word("b"));
    expect(getLogs).not.toHaveBeenCalled();
  });

  it("does not mark an archive that is behind the RPC head as caught up", async () => {
    vi.spyOn(eventSource, "readCoreEvents").mockResolvedValue({ logs: [], nextBlock: 1n, source: "envio" });
    expect(await runIndexerWorker(1n)).toBe(0);
    expect(indexerRepo.advance).not.toHaveBeenCalled();
    expect(indexerRepo.record).not.toHaveBeenCalled();
  });

  it("indexes a full checkpoint through the public RPC's bounded log windows", async () => {
    getBlock.mockImplementation(async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber ?? 500n, hash: word("b") }));
    getLogs.mockImplementation(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      if (toBlock - fromBlock >= 100n) throw new Error("rpc-range-limit");
      return [];
    });
    await runIndexerWorker(1n);
    expect(getLogs).toHaveBeenCalledTimes(5);
    expect(indexerRepo.advance).toHaveBeenCalledWith(expect.any(String), "lease", 501n, word("b"));
  });

  it("preserves the checkpoint if one bounded log window is unavailable", async () => {
    getBlock.mockImplementation(async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber ?? 500n, hash: word("b") }));
    getLogs.mockImplementation(async ({ fromBlock }: { fromBlock: bigint }) => {
      if (fromBlock === 201n) throw new Error("rpc-gap");
      return [];
    });
    await expect(runIndexerWorker(1n)).rejects.toThrow("rpc-gap");
    expect(indexerRepo.advance).not.toHaveBeenCalled();
    expect(indexerRepo.record).not.toHaveBeenCalled();
  });

  it("refreshes readiness when a caught-up chain has no new blocks", async () => {
    vi.mocked(indexerRepo.claim).mockResolvedValue({ nextBlock: "3", lease: "lease", lastBlockHash: word("b") });
    expect(await runIndexerWorker(1n)).toBe(0);
    expect(indexerRepo.advance).toHaveBeenCalledWith(expect.any(String), "lease", 3n, word("b"));
    expect(getLogs).not.toHaveBeenCalled();
  });
  it("checkpoints only after canonical events, credit state, and durable refresh jobs", async () => {
    expect(await runIndexerWorker(1n)).toBe(1);
    expect(calls).toEqual(["record", "refresh", "queue", "advance"]);
    expect(indexerRepo.advance).toHaveBeenCalledWith(expect.any(String), "lease", 3n, word("b"));
    expect(creditService.refresh).toHaveBeenCalledWith(creditId);
  });

  it.each(["Upgraded", "AdminChanged"] as const)("indexes the proxy's %s event without blocking credit checkpoints", async (name) => {
    const proxyEvents = parseAbi(["event Upgraded(address indexed implementation)",
      "event AdminChanged(address previousAdmin,address newAdmin)"]);
    getLogs.mockResolvedValue([{ blockNumber: 2n, blockHash: word("b"), transactionHash: word("c"), logIndex: 0,
      removed: false, data: name === "Upgraded" ? "0x" : encodeAbiParameters([{ type: "address" }, { type: "address" }], [address, address]),
      topics: encodeEventTopics({ abi: proxyEvents, eventName: name, args: { implementation: address } }) }]);
    expect(await runIndexerWorker(1n)).toBe(1);
    expect(indexerRepo.record).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: name }));
    expect(creditService.refresh).not.toHaveBeenCalled();
    expect(queue.push).not.toHaveBeenCalled();
    expect(indexerRepo.advance).toHaveBeenCalled();
  });

  it("preserves the checkpoint for an unknown event signature", async () => {
    getLogs.mockResolvedValue([{ blockNumber: 2n, blockHash: word("b"), transactionHash: word("c"), logIndex: 0,
      removed: false, data: "0x", topics: [word("e")] }]);
    await expect(runIndexerWorker(1n)).rejects.toThrow("not found on ABI");
    expect(indexerRepo.record).not.toHaveBeenCalled();
    expect(indexerRepo.advance).not.toHaveBeenCalled();
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

  it("durably schedules a current Ethereum recovery authorization after indexing its finalized event", async () => {
    const authorization = parseAbi(["event RemoteActionAuthorized(bytes32 indexed creditId,bytes32 indexed actionHash,uint8 kind)"]);
    getLogs.mockResolvedValue([{ blockNumber: 2n, blockHash: word("b"), transactionHash: word("c"), logIndex: 0,
      removed: false, data: encodeAbiParameters([{ type: "uint8" }], [1]),
      topics: encodeEventTopics({ abi: authorization, eventName: "RemoteActionAuthorized", args: { creditId, actionHash: word("d") } }) }]);
    vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 143, getBlock, getLogs,
      readContract: async ({ functionName }: { functionName: string }) => functionName === "solanaCollateral" ? false : word("d"),
    } as never);
    await runIndexerWorker(1n);
    expect(queue.push).toHaveBeenCalledWith(expect.objectContaining({ kind: "collateral.remote-authorized",
      payload: { creditId, actionHash: word("d"), kind: 1, authorizationTxHash: word("c") } }));
    expect(calls.at(-1)).toBe("advance");
    calls = [];
    vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 143, getBlock, getLogs,
      readContract: async ({ functionName }: { functionName: string }) => functionName === "solanaCollateral" ? true : word("d"),
    } as never);
    await runIndexerWorker(1n);
    expect(queue.push).toHaveBeenCalledWith(expect.objectContaining({ kind: "collateral.solana-authorized",
      payload: { creditId, actionHash: word("d"), kind: 1, authorizationTxHash: word("c") } }));
  });
});
