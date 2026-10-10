import { sampleSuite } from "./suite.fixture.js";
import { suiteHash } from "../../src/integration/integration.suite.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { monadClient } from "../../src/chain/monad.client.js";
import { integrationRepo } from "../../src/integration/integration.repo.js";
import { integrationService } from "../../src/integration/integration.service.js";
import { validateIntegrationAcceptance } from "../../src/integration/integration.builder.js";
import { validateIntegrationSources, verifyIntegrationSourcePins } from "../../src/integration/integration.source.js";
import { applicationService } from "../../src/integration/application.service.js";
import { keccak256, stringToHex, toFunctionSelector } from "viem";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/integration/integration.repo.js", () => ({ integrationRepo: {
  create: vi.fn(), byTokenHash: vi.fn(), list: vi.fn(),
} }));
vi.mock("../../src/integration/integration.builder.js", () => ({ validateIntegrationAcceptance: vi.fn() }));
vi.mock("../../src/integration/integration.source.js", () => ({
  validateIntegrationSources: vi.fn(), verifyIntegrationSourcePins: vi.fn(),
}));
vi.mock("../../src/integration/application.service.js", () => ({ applicationService: {
  requireVerified: vi.fn(),
} }));
vi.mock("../../src/config/env.js", () => ({ env: {
  core: `0x${"1".repeat(40)}`, monadChainId: 143,
  accountFactory: `0x${"2".repeat(40)}`,
  publicApiBase: "https://api.termbook.example", publicRpcUrl: "https://rpc.termbook.example",
  settlementFactory: "",
} }));

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const versionId = `0x${"a".repeat(64)}`;
const applicationId = "1f3474c2-f4c2-461d-919d-143749012e27";
const codeHash = `0x${"b".repeat(64)}`;
const settlementAsset = address("8");
const priceArguments = [{ source: "input" as const, path: "direction", choices: { long: "1", short: "2" } },
  { source: "price_bound" as const }, { source: "input" as const, path: "market_id" }];
const price = { slippagePath: "slippage_bps", directionPath: "direction", maximumDirections: ["long"],
  minimumDirections: ["short"], markets: [`0x${"a".repeat(64)}`] };
const actions = [{ capability: "place_order", label: "Place order", target: address("7"),
  signature: "function placeOrder(uint256 margin,address account,uint256 direction,uint256 bound,uint256 market,uint256 notional)",
  arguments: [{ source: "input" as const, path: "amount.margin" }, { source: "credit_account" as const }, ...priceArguments,
    { source: "input" as const, path: "amount.notional" }],
  when: { order_type: "market" as const }, marketPath: "market_id", price, fundingPath: "amount.margin", settlement: "atomic" as const },
  { capability: "close_position", label: "Close position", target: address("7"),
    signature: "function closePosition(uint256 positionId,address account,uint256 direction,uint256 bound,uint256 market)",
    arguments: [{ source: "input" as const, path: "position_id", label: "Position ID" },
      { source: "credit_account" as const }, { source: "state" as const, path: "direction", choices: { long: "1", short: "2" } },
      { source: "price_bound" as const }, { source: "state" as const, path: "market_id" }],
    marketPath: "_state.market_id", price: { ...price, directionPath: "_state.direction" },
    positionState: { target: address("7"), signature: "function position(address account,uint256 id) view returns (uint256 market,uint8 direction)",
      arguments: [{ source: "credit_account" as const }, { source: "input" as const, path: "position_id" }],
      marketIndex: 0, directionIndex: 1, directions: { long: "1", short: "2" } }, settlement: "atomic" as const }];
const suite = sampleSuite({ versionId, manifestHash: codeHash });
const acceptance = { suite, evidenceHash: suiteHash(suite),
  activeCreditId: `0x${"c".repeat(64)}`, recoveredCreditId: `0x${"d".repeat(64)}`,
  actionTransactions: { place_order: { creditId: `0x${"d".repeat(64)}`, txHash: `0x${"1".repeat(64)}` },
    close_position: { creditId: `0x${"d".repeat(64)}`, txHash: `0x${"4".repeat(64)}` } },
  recoveryTxHashes: [`0x${"2".repeat(64)}`], repaymentTxHash: `0x${"3".repeat(64)}` };
const verifiedSources = [{ target: address("7"), sourceHash: `0x${"f".repeat(64)}` }];
const sourcePins = [{ target: address("7"), codeHash: keccak256("0x1234"),
  sourceHash: verifiedSources[0]!.sourceHash, implementation: null,
  implementationSlot: null, implementationCodeHash: null, implementationSourceHash: null }];
let readerAdapter = address("9");

beforeEach(() => {
  vi.clearAllMocks();
  readerAdapter = address("9");
  vi.mocked(validateIntegrationSources).mockResolvedValue(sourcePins as never);
  vi.mocked(verifyIntegrationSourcePins).mockResolvedValue(true);
  vi.mocked(applicationService.requireVerified).mockResolvedValue({ id: applicationId,
    owner: address("f"), origin: "https://trade.example.org", chainId: 143 });
  const chain = {
    getBlock: vi.fn(async () => ({ number: 100n })),
    getChainId: vi.fn(async () => 143),
    getBytecode: vi.fn(async () => "0x1234"),
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "executionVersion") return 2n;
      if (functionName === "priceProtection") return address("e");
      if (functionName === "ruleHashes") return codeHash;
      if (functionName === "read") return [2000n * 10n ** 18n, 1000n, 1n];
      if (functionName === "rule") return { oracle: address("f"), feedId: codeHash, target: address("7"),
        selector: toFunctionSelector(args?.[1] === keccak256(stringToHex("place_order")) ? actions[0]!.signature : actions[1]!.signature),
        callIndex: 0, priceDecimals: 8, priceWord: 3, directionWord: 2, maxSlippageBps: 100,
        maxDeviationBps: 500, maxAuthorizationAge: 60, maximumDirection: 1n, minimumDirection: 2n };
      if (functionName === "integrationRegistry") return address("3");
      if (functionName === "healthSource") return address("4");
      if (functionName === "exitVerifierOfBundle") return address("5");
      if (functionName === "appRecoveryAdapterOfBundle") return address("9");
      if (functionName === "exitVerifierCodeHash" || functionName === "appRecoveryAdapterCodeHash") return keccak256("0x1234");
      if (functionName === "riskEngine") return address("6");
      if (functionName === "versions") return [codeHash, true, false];
      if (functionName === "readers") return [address("a"), 1n, true, 100n, keccak256("0x1234")];
      if (functionName === "core") return address("1");
      if (functionName === "bundleId") return versionId;
      if (functionName === "recoveryAdapter") return readerAdapter;
      if (functionName === "appReader") return address("b");
      if (functionName === "appReaderCodeHash") return keccak256("0x1234");
      if (functionName === "managedBundle" || functionName === "dependencyValid") return true;
      if (functionName === "executionManager") return address("c");
      if (functionName === "bundles") return [address("d"), address("b"), keccak256("0x1234"), keccak256("0x1234"),
        keccak256("0xabcd"), 32, 32, 300];
      if (functionName === "isActive" || functionName === "isReaderActive" || functionName === "isCallAllowed") return true;
      if (functionName === "recoveryCallCount") return 1n;
      throw new Error("unexpected-read");
    }),
  };
  vi.mocked(monadClient).mockReturnValue(chain as never);
});

describe("integration app token", () => {
  it("rejects perps publication without enforceable execution prices", async () => {
    await expect(integrationService.approve({ applicationId, category: "perps", versionId, codeHash,
      settlementAsset, actions: actions.map((action) => ({ ...action, price: undefined })), verifiedSources, acceptance }))
      .rejects.toThrow("integration-not-admitted");
    expect(integrationRepo.create).not.toHaveBeenCalled();
    const chain = monadClient();
    const actual = vi.mocked(chain.readContract).getMockImplementation()!;
    vi.mocked(chain.readContract).mockImplementation(async (request) => request.functionName === "rule"
      ? { ...(await actual(request) as object), priceWord: 99 } as never : actual(request));
    await expect(integrationService.approve({ applicationId, category: "perps", versionId, codeHash,
      settlementAsset, actions, verifiedSources, acceptance })).rejects.toThrow("integration-not-admitted");
  });
  it("issues a token only for an admitted bundle and stores only its hash", async () => {
    const result = await integrationService.approve({ applicationId, category: "perps", versionId, codeHash, settlementAsset, actions,
      verifiedSources, acceptance });
    expect(result.appToken).toMatch(/^tbk_[a-f0-9]{64}$/);
    expect(integrationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      versionId, codeHash, settlementAsset, sourcePins,
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(JSON.stringify(vi.mocked(integrationRepo.create).mock.calls[0])).not.toContain(result.appToken);
    expect(validateIntegrationAcceptance).toHaveBeenCalledWith(versionId, settlementAsset, actions, acceptance, codeHash);
  });

  it("resolves only an active token and returns Core derived risk config", async () => {
    const result = await integrationService.approve({ applicationId, category: "perps", versionId, codeHash, settlementAsset, actions,
      verifiedSources, acceptance });
    vi.mocked(integrationRepo.byTokenHash).mockResolvedValue({ category: "perps", versionId, codeHash, settlementAsset, actions,
      acceptance, review: { evidenceHash: acceptance.evidenceHash, mode: suite.mode }, sourcePins, accepted: true, active: true, frozen: false } as never);
    const resolved = await integrationService.resolve(result.appToken);
    expect(resolved).toMatchObject({ appToken: result.appToken, core: address("1"), riskEngine: address("6"),
      accountFactory: address("2"), settlementAsset, chainId: 143, use_case: "perps" });
    expect(integrationRepo.byTokenHash).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/));
  });

  it("checks token admission, prices and code at the same finalized block", async () => {
    vi.mocked(integrationRepo.byTokenHash).mockResolvedValue({ category: "perps", versionId, codeHash, settlementAsset, actions,
      acceptance, review: { evidenceHash: acceptance.evidenceHash, mode: suite.mode }, sourcePins, accepted: true, active: true, frozen: false } as never);
    const chain = monadClient();
    vi.mocked(chain.getBlock).mockResolvedValue({ number: 200n } as never);
    await integrationService.resolve(`tbk_${"a".repeat(64)}`);
    expect(chain.getBlock).toHaveBeenCalledTimes(1);
    expect(verifyIntegrationSourcePins).toHaveBeenCalledWith(sourcePins, 200n);
    expect(vi.mocked(chain.readContract).mock.calls.every(([request]) => request.blockNumber === 200n)).toBe(true);
    expect(vi.mocked(chain.getBytecode).mock.calls.every(([request]) => request.blockNumber === 200n)).toBe(true);
  });

  it("rejects a frozen local integration before returning deployment config", async () => {
    const result = await integrationService.approve({ applicationId, category: "perps", versionId, codeHash, settlementAsset, actions,
      verifiedSources, acceptance });
    vi.mocked(integrationRepo.byTokenHash).mockResolvedValue({ category: "perps", versionId, codeHash, settlementAsset, actions,
      acceptance, review: { evidenceHash: acceptance.evidenceHash, mode: suite.mode }, sourcePins, accepted: true, active: true, frozen: true } as never);
    await expect(integrationService.resolve(result.appToken)).rejects.toThrow("integration-not-found");
  });

  it("rejects a legacy token without acceptance evidence", async () => {
    const result = await integrationService.approve({ applicationId, category: "perps", versionId, codeHash, settlementAsset, actions,
      verifiedSources, acceptance });
    vi.mocked(integrationRepo.byTokenHash).mockResolvedValue({ category: "perps", versionId, codeHash, settlementAsset, actions,
      sourcePins, active: true, frozen: false } as never);
    await expect(integrationService.resolve(result.appToken)).rejects.toThrow("integration-not-found");
  });

  it("rejects a health reader bound to another recovery adapter", async () => {
    readerAdapter = address("e");
    await expect(integrationService.approve({ applicationId, category: "perps", versionId, codeHash, settlementAsset, actions,
      verifiedSources, acceptance }))
      .rejects.toThrow("integration-not-admitted");
  });

  it("rejects a changed source pin when resolving an app token", async () => {
    const result = await integrationService.approve({ applicationId, category: "perps", versionId, codeHash, settlementAsset, actions,
      verifiedSources, acceptance });
    vi.mocked(integrationRepo.byTokenHash).mockResolvedValue({ category: "perps", versionId, codeHash, settlementAsset, actions,
      acceptance, review: { evidenceHash: acceptance.evidenceHash, mode: suite.mode }, sourcePins, accepted: true, active: true, frozen: false } as never);
    vi.mocked(verifyIntegrationSourcePins).mockResolvedValue(false);
    await expect(integrationService.resolve(result.appToken)).rejects.toThrow("integration-not-found");
  });
});
