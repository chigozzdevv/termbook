import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, stringToHex } from "viem";
import { monadClient } from "../../src/chain/monad.client.js";
import { keeperTransaction } from "../../src/chain/keeper.js";
import { priceReferenceConfig, runPriceReferenceWorker } from "../../src/chain/price-reference.worker.js";
import { integrationRepo } from "../../src/integration/integration.repo.js";
import { logger } from "../../src/logging/logger.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn() }));
vi.mock("../../src/integration/integration.repo.js", () => ({ integrationRepo: { list: vi.fn() } }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 10143, rpcUrl: "http://monad", core: `0x${"11".repeat(20)}` } }));
vi.mock("../../src/logging/logger.js", () => ({ logger: { warn: vi.fn() } }));
const address = `0x${"11".repeat(20)}` as const;
const key = `0x${"22".repeat(32)}`;
const bundle = keccak256(stringToHex("bundle"));
const capability = keccak256(stringToHex("buy"));
const market = keccak256(stringToHex("MON-USDC"));
const readContract = vi.fn();
const simulateContract = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PRICE_REFERENCE_RULES", JSON.stringify([{ bundle, capability, market }]));
  vi.stubEnv("ORACLE_KEEPER_KEY", key);
  vi.stubEnv("RISK_KEEPER_KEY", "");
  readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (functionName === "priceProtection") return address;
    if (functionName === "referenceVersion") return 1n;
    if (functionName === "rule") return { oracle: address, maxAuthorizationAge: 90 };
    if (functionName === "priceReference") return [100n, 950n, 1n, 950n];
    throw new Error("unexpected call");
  });
  vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 10143,
    getBlock: async () => ({ number: 5n, timestamp: 1000n }), readContract, simulateContract } as never);
  vi.mocked(integrationRepo.list).mockResolvedValue([]);
  vi.mocked(keeperTransaction).mockResolvedValue("success");
});
afterEach(() => vi.unstubAllEnvs());

describe("execution price checkpoints", () => {
  it("records an aging reference through the durable keeper journal", async () => {
    expect(await runPriceReferenceWorker()).toBe(1);
    expect(keeperTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: address,
      operation: `price-reference:${bundle}:${capability}:${market}:5`, chainId: 10143 }));
  });
  it("does not spend gas for a recent authenticated checkpoint", async () => {
    const original = readContract.getMockImplementation()!;
    readContract.mockImplementation(async (request) => request.functionName === "priceReference" ? [100n, 990n, 2n, 990n] : original(request));
    expect(await runPriceReferenceWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
  it("refreshes a missing checkpoint but never bypasses source validation", async () => {
    const original = readContract.getMockImplementation()!;
    readContract.mockImplementation(async (request) => {
      if (request.functionName === "priceReference") throw new Error("stale");
      return original(request);
    });
    expect(await runPriceReferenceWorker()).toBe(1);
    vi.mocked(keeperTransaction).mockClear();
    simulateContract.mockRejectedValueOnce(new Error("guard-revoked"));
    expect(await runPriceReferenceWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("price-reference-unavailable", expect.objectContaining({ reason: "price-source-unavailable" }));
  });
  it("discovers admitted application rules and ignores frozen integrations", async () => {
    vi.stubEnv("PRICE_REFERENCE_RULES", "[]");
    const action = { capability: "place_order", executionKey: "buy", label: "Buy", target: address,
      signature: "function trade(uint256)", arguments: [{ source: "price_bound" }], settlement: "atomic",
      price: { kind: "min_output", amountPath: "amount.spend", slippagePath: "slippage_bps", markets: [market] } };
    vi.mocked(integrationRepo.list).mockResolvedValue([{ versionId: bundle, actions: [action],
      packageDefinition: { chain_id: 10143 } }, { versionId: bundle, frozen: true, actions: [action], packageDefinition: { chain_id: 10143 } }] as never);
    expect(await runPriceReferenceWorker()).toBe(1);
    expect(keeperTransaction).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed or unregistered rules", async () => {
    vi.stubEnv("PRICE_REFERENCE_RULES", JSON.stringify([{ bundle, capability, market, extra: true }]));
    expect(priceReferenceConfig).toThrow("price-reference-config-invalid");
    vi.stubEnv("PRICE_REFERENCE_RULES", JSON.stringify([{ bundle, capability, market }]));
    const original = readContract.getMockImplementation()!;
    readContract.mockImplementation(async (request) => request.functionName === "rule" ? { oracle: `0x${"00".repeat(20)}`, maxAuthorizationAge: 0 } : original(request));
    expect(await runPriceReferenceWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
  });
});
