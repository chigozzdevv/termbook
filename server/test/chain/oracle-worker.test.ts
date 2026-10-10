import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { monadClient } from "../../src/chain/monad.client.js";
import { keeperTransaction } from "../../src/chain/keeper.js";
import { ratioFeedConfig, runOracleWorker } from "../../src/chain/oracle.worker.js";
import { logger } from "../../src/logging/logger.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn() }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 10143, rpcUrl: "http://monad" } }));
vi.mock("../../src/logging/logger.js", () => ({ logger: { warn: vi.fn() } }));
const feed = `0x${"11".repeat(20)}` as const;
const key = `0x${"22".repeat(32)}`;
const hash = keccak256("0x1234");
const simulateContract = vi.fn();
const readContract = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RATIO_PRICE_FEEDS", JSON.stringify([{ address: feed, codeHash: hash }]));
  vi.stubEnv("ORACLE_KEEPER_KEY", key);
  vi.stubEnv("RISK_KEEPER_KEY", "");
  readContract.mockImplementation(async ({ functionName, args }: { functionName: string; args?: string[] }) => {
    switch (functionName) {
      case "oracle": return feed;
      case "baseId": return `0x${"33".repeat(32)}`;
      case "quoteId": return `0x${"44".repeat(32)}`;
      case "baseRound": case "quoteRound": return 1n;
      case "read": return [100n, 100n, args?.[0]?.startsWith("0x33") ? 2n : 1n];
      default: throw new Error("unexpected call");
    }
  });
  vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 10143,
    getBlock: async () => ({ number: 5n }), getCode: async () => "0x1234", readContract, simulateContract } as never);
  vi.mocked(keeperTransaction).mockResolvedValue("success");
});
afterEach(() => vi.unstubAllEnvs());

describe("ratio oracle upkeep", () => {
  it("updates a changed source round through the durable keeper journal", async () => {
    expect(await runOracleWorker()).toBe(1);
    expect(keeperTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: feed,
      operation: `oracle:${feed}:2:1`, chainId: 10143 }));
  });
  it("does not spend gas while cached rounds match", async () => {
    readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "oracle") return feed;
      if (functionName === "baseId" || functionName === "quoteId") return hash;
      if (functionName === "read") return [100n, 100n, 1n];
      return 1n;
    });
    expect(await runOracleWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("never submits when the pinned implementation changes or sources reject", async () => {
    vi.stubEnv("RATIO_PRICE_FEEDS", JSON.stringify([{ address: feed, codeHash: keccak256("0x5678") }]));
    expect(await runOracleWorker()).toBe(0);
    vi.stubEnv("RATIO_PRICE_FEEDS", JSON.stringify([{ address: feed, codeHash: hash }]));
    readContract.mockRejectedValue(new Error("stale source"));
    expect(await runOracleWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("rejects duplicate feeds and a key shared with another keeper", () => {
    vi.stubEnv("RATIO_PRICE_FEEDS", JSON.stringify([{ address: feed, codeHash: hash }, { address: feed, codeHash: hash }]));
    expect(ratioFeedConfig).toThrow("oracle-feeds-config-invalid");
    vi.stubEnv("RATIO_PRICE_FEEDS", JSON.stringify([{ address: feed, codeHash: hash }]));
    vi.stubEnv("RISK_KEEPER_KEY", key);
    expect(ratioFeedConfig).toThrow("oracle-keeper-key-conflict");
  });
  it("reports insufficient funding without exposing the full exception", async () => {
    vi.mocked(keeperTransaction).mockRejectedValue(new Error("keeper-funding-insufficient: wallet=private-context"));
    expect(await runOracleWorker()).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith("oracle-update-unavailable", {
      feed, reason: "keeper-funding-insufficient",
    });
  });
});
