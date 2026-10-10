import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";

const mocks = vi.hoisted(() => ({ get: vi.fn(), chain: vi.fn(), construct: vi.fn(), receipt: vi.fn(), rpcLogs: vi.fn() }));
vi.mock("@envio-dev/hypersync-client", () => ({ HypersyncClient: class {
  constructor(config: unknown) { mocks.construct(config); }
  get = mocks.get;
  getChainId = mocks.chain;
} }));
const address = `0x${"1".repeat(40)}`;
const word = (digit: string) => `0x${digit.repeat(64)}`;
const log = () => ({ address, blockNumber: 2, blockHash: word("b"), transactionHash: word("c"),
  logIndex: 0, data: "0x1234", topics: [word("d"), null, null, null], removed: false });
const rpc = () => ({ getTransactionReceipt: mocks.receipt, getLogs: mocks.rpcLogs }) as unknown as PublicClient;
afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("ENVIO_API_TOKEN", "test-token");
  vi.stubEnv("ENVIO_HYPERSYNC_URL", "");
  vi.stubEnv("MONAD_CHAIN_ID", "10143");
  vi.stubEnv("CORE_ADDRESS", address);
  mocks.chain.mockResolvedValue(10143);
  mocks.get.mockResolvedValue({ nextBlock: 10, data: { logs: [log()] } });
  mocks.receipt.mockResolvedValue({ status: "success", blockNumber: 2n, blockHash: word("b"),
    logs: [{ ...log(), blockNumber: 2n, topics: [word("d")] }] });
});

describe("Envio event ingestion", () => {
  it("queries Monad testnet with an exclusive finalized bound and resumes a partial page", async () => {
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    const result = await readCoreEvents(rpc(), 1n, 50_000n);
    expect(mocks.construct).toHaveBeenCalledWith(expect.objectContaining({ url: "https://10143.hypersync.xyz", apiToken: "test-token" }));
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 1, toBlock: 50_001, logs: [{ address: [address] }] }));
    expect(result).toEqual({ logs: [{ ...log(), blockNumber: 2n, topics: [word("d")] }], nextBlock: 10n, source: "envio" });
    expect(mocks.rpcLogs).not.toHaveBeenCalled();
  });
  it("bounds large backfills and preserves event order", async () => {
    mocks.get.mockResolvedValue({ nextBlock: 100_001, data: { logs: [
      { ...log(), logIndex: 1 }, log(),
    ] } });
    mocks.receipt.mockResolvedValue({ status: "success", blockNumber: 2n, blockHash: word("b"),
      logs: [0, 1].map((logIndex) => ({ ...log(), logIndex, blockNumber: 2n, topics: [word("d")] })) });
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    const result = await readCoreEvents(rpc(), 1n, 1_000_000n);
    expect(mocks.get.mock.calls[0]![0].toBlock).toBe(100_001);
    expect(result.logs.map((entry) => entry.logIndex)).toEqual([0, 1]);
  });
  it("leaves the checkpoint unchanged when the archive has not caught up", async () => {
    mocks.get.mockResolvedValue({ nextBlock: 1, data: { logs: [] } });
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    expect((await readCoreEvents(rpc(), 1n, 100n)).nextBlock).toBe(1n);
  });
  it("rejects the wrong chain before querying events", async () => {
    mocks.chain.mockResolvedValue(143);
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    await expect(readCoreEvents(rpc(), 1n, 100n)).rejects.toThrow("envio-chain-mismatch");
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each([0, 102, NaN, 1.5])("rejects an invalid page boundary: %s", async (nextBlock) => {
    mocks.get.mockResolvedValue({ nextBlock, data: { logs: [] } });
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    await expect(readCoreEvents(rpc(), 1n, 100n)).rejects.toThrow("envio-page-invalid");
  });
  it.each([
    { blockNumber: 10 }, { blockNumber: -1 }, { logIndex: -1 }, { address: `0x${"2".repeat(40)}` },
    { removed: true }, { data: "0x1" }, { topics: [word("d"), null, word("e")] }, { blockHash: "0x1" },
  ])("rejects malformed or out-of-range events: %j", async (change) => {
    mocks.get.mockResolvedValue({ nextBlock: 10, data: { logs: [{ ...log(), ...change }] } });
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    await expect(readCoreEvents(rpc(), 1n, 100n)).rejects.toThrow("envio-log-invalid");
  });
  it("rejects duplicate event identities", async () => {
    mocks.get.mockResolvedValue({ nextBlock: 10, data: { logs: [log(), log()] } });
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    await expect(readCoreEvents(rpc(), 1n, 100n)).rejects.toThrow("envio-log-duplicate");
  });
  it.each(["changed", "omitted", "reverted"])("rejects %s receipt data", async (kind) => {
    mocks.receipt.mockResolvedValue({ status: kind === "reverted" ? "reverted" : "success", blockNumber: 2n, blockHash: word("b"),
      logs: kind === "omitted" ? [] : [{ ...log(), topics: [word("d")], data: "0xabcd" }] });
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    await expect(readCoreEvents(rpc(), 1n, 100n)).rejects.toThrow("envio-receipt-mismatch");
  });
  it("does not fall back or disclose provider error text after a failed query", async () => {
    mocks.get.mockRejectedValue(new Error("request failed with test-token"));
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    await expect(readCoreEvents(rpc(), 1n, 100n)).rejects.toThrow("envio-query-unavailable");
    expect(mocks.rpcLogs).not.toHaveBeenCalled();
  });
  it("uses bounded RPC windows when Envio is not configured", async () => {
    vi.stubEnv("ENVIO_API_TOKEN", "");
    mocks.rpcLogs.mockResolvedValue([]);
    const { readCoreEvents } = await import("../../src/chain/envio.client.js");
    expect(await readCoreEvents(rpc(), 1n, 1000n)).toEqual({ logs: [], nextBlock: 501n, source: "rpc" });
    expect(mocks.rpcLogs).toHaveBeenCalledTimes(5);
    expect(mocks.construct).not.toHaveBeenCalled();
  });
  it.each(["https://user:password@10143.hypersync.xyz", "http://10143.hypersync.xyz", "https://10143.hypersync.xyz/?token=secret"])("rejects unsafe endpoint configuration", async (url) => {
    vi.stubEnv("ENVIO_HYPERSYNC_URL", url);
    const { assertEnvioConfig } = await import("../../src/chain/envio.client.js");
    expect(assertEnvioConfig).toThrow("envio-url-invalid");
  });
});
