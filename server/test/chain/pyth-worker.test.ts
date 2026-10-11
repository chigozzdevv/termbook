import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { monadClient } from "../../src/chain/monad.client.js";
import { keeperTransaction } from "../../src/chain/keeper.js";
import { fetchPythUpdates, preparePythUpdates, pythEndpoint, pythOracleConfig } from "../../src/chain/pyth.client.js";
import { ensurePythPrices, runPythOracleWorker } from "../../src/chain/pyth.worker.js";
import { logger } from "../../src/logging/logger.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn() }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 10143, rpcUrl: "http://monad" } }));
vi.mock("../../src/logging/logger.js", () => ({ logger: { warn: vi.fn() } }));
const address = `0x${"11".repeat(20)}` as const;
const id = `0x${"33".repeat(32)}` as const;
const price = { price: 100_000_000n, conf: 10_000n, expo: -8, publishTime: 999n };
const source = { address, codeHash: keccak256("0x1234"), maximumUpdateFee: "1000",
  feeds: [{ id, maxAgeSeconds: 300, refreshAgeSeconds: 60, maxConfidenceBps: 50 }] };
const readContract = vi.fn();
const simulateContract = vi.fn();
const fetchMock = vi.fn();
function response(binary: unknown = { encoding: "hex", data: ["abcd"] }) {
  return new Response(JSON.stringify({ binary, parsed: [{ id, price: { price: "999999999999", publish_time: 1000 } }] }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PYTH_PRICE_FEEDS", JSON.stringify([source]));
  vi.stubEnv("PYTH_API_KEY", "private-pyth-key");
  vi.stubEnv("PYTH_HERMES_URL", "https://hermes.pyth.network");
  vi.stubEnv("ORACLE_KEEPER_KEY", `0x${"22".repeat(32)}`);
  vi.stubEnv("RISK_KEEPER_KEY", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => response());
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => functionName === "getUpdateFee" ? 1n : { ...price, publishTime: 1n });
  simulateContract.mockResolvedValue({ result: [{ id, price, emaPrice: price }] });
  vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 10143, getBlock: async () => ({ number: 5n, timestamp: 1000n }),
    getCode: async () => "0x1234", readContract, simulateContract } as never);
  vi.mocked(keeperTransaction).mockResolvedValue("success");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("authenticated Pyth upkeep", () => {
  it("verifies the proof onchain and submits the exact payload through the keeper journal", async () => {
    expect(await runPythOracleWorker()).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: { Authorization: "Bearer private-pyth-key" }, redirect: "error",
    }));
    expect(simulateContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "parsePriceFeedUpdates", args: [["0xabcd"], [id], 940n, 1000n], value: 1n }));
    expect(keeperTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: address, value: 1n,
      operation: `pyth:${address}:${id}:999`, chainId: 10143 }));
  });
  it("does not fetch or spend gas while authenticated onchain prices remain fresh", async () => {
    readContract.mockResolvedValue(price);
    expect(await runPythOracleWorker()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures instead of trusting the API's parsed price", async () => {
    simulateContract.mockRejectedValue(new Error("InvalidUpdateData"));
    expect(await runPythOracleWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it.each([
    { ...price, publishTime: 939n }, { ...price, publishTime: 1001n },
    { ...price, conf: 1_000_000n }, { ...price, price: -1n },
  ])("rejects stale, future, uncertain or negative authenticated updates", async (invalid) => {
    simulateContract.mockResolvedValue({ result: [{ id, price: invalid, emaPrice: invalid }] });
    expect(await runPythOracleWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("rejects updates for a different asset", async () => {
    simulateContract.mockResolvedValue({ result: [{ id: `0x${"44".repeat(32)}`, price, emaPrice: price }] });
    expect(await runPythOracleWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("caps update fees and rejects changed source code", async () => {
    readContract.mockImplementation(async ({ functionName }: { functionName: string }) => functionName === "getUpdateFee" ? 1001n : { ...price, publishTime: 1n });
    expect(await runPythOracleWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
    vi.stubEnv("PYTH_PRICE_FEEDS", JSON.stringify([{ ...source, codeHash: keccak256("0x5678") }]));
    expect(await runPythOracleWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("does not approve a preflight until finalized prices are independently fresh", async () => {
    await expect(ensurePythPrices()).rejects.toThrow("pyth-price-unavailable");
    readContract.mockResolvedValue(price);
    await expect(ensurePythPrices()).resolves.toBeUndefined();
  });
  it("reports authentication failure without exposing the API key", async () => {
    fetchMock.mockResolvedValue(new Response("rejected", { status: 401 }));
    expect(await runPythOracleWorker()).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith("pyth-update-unavailable", { source: address, reason: "pyth-updates-unavailable" });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain("private-pyth-key");
  });
});

describe("Pyth configuration and payload boundaries", () => {
  it("rejects unconfigured feeds before contacting a price service", async () => {
    const config = pythOracleConfig()!, configured = config.sources[0]!;
    for (const feeds of [[], [...configured.feeds, ...configured.feeds], [{ ...configured.feeds[0]!, maxConfidenceBps: 1000 }]]) {
      await expect(preparePythUpdates(monadClient(), config, configured, feeds)).rejects.toThrow("pyth-feeds-invalid");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts authenticated HTTPS endpoints without embedded credentials or redirects", () => {
    expect(pythEndpoint("https://pyth.dourolabs.app/hermes")).toBe("https://pyth.dourolabs.app/hermes");
    for (const endpoint of ["http://hermes.pyth.network", "https://user:secret@hermes.pyth.network", "https://hermes.pyth.network?key=secret", "https://hermes.pyth.network/redirect"]) {
      expect(() => pythEndpoint(endpoint)).toThrow("pyth-endpoint-invalid");
    }
  });
  it("supports disabled configuration and rejects duplicate or inconsistent feeds", () => {
    vi.stubEnv("PYTH_PRICE_FEEDS", "[]");
    expect(pythOracleConfig()).toBeNull();
    vi.stubEnv("PYTH_PRICE_FEEDS", JSON.stringify([{ ...source, feeds: [...source.feeds, ...source.feeds] }]));
    expect(pythOracleConfig).toThrow("pyth-config-invalid");
    vi.stubEnv("PYTH_PRICE_FEEDS", JSON.stringify([{ ...source, feeds: [{ ...source.feeds[0], refreshAgeSeconds: 300 }] }]));
    expect(pythOracleConfig).toThrow("pyth-config-invalid");
    vi.stubEnv("PYTH_PRICE_FEEDS", JSON.stringify([source]));
    vi.stubEnv("PYTH_HERMES_URL", "http://hermes.pyth.network");
    expect(pythOracleConfig).toThrow("pyth-endpoint-invalid");
  });
  it("rejects malformed, duplicate and oversized binary payloads", async () => {
    const config = pythOracleConfig()!;
    for (const binary of [{ encoding: "base64", data: ["abcd"] }, { encoding: "hex", data: ["xyz"] },
      { encoding: "hex", data: ["abcd", "abcd"] }, { encoding: "hex", data: ["aa".repeat(40_000)] }]) {
      fetchMock.mockResolvedValue(response(binary));
      await expect(fetchPythUpdates(config, [id])).rejects.toThrow("pyth-updates-invalid");
    }
    fetchMock.mockResolvedValue(new Response("x".repeat(262_145)));
    await expect(fetchPythUpdates(config, [id])).rejects.toThrow("pyth-updates-invalid");
  });
});
