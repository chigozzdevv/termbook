import { sampleSuite } from "./suite.fixture.js";
import { suiteHash } from "../../src/integration/integration.suite.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

vi.mock("../../src/integration/candidate.repo.js", () => ({ candidateRepo: {
  create: vi.fn(), get: vi.fn(), setMapping: vi.fn(), setProposal: vi.fn(), activate: vi.fn(), beginValidation: vi.fn(), renewValidation: vi.fn(), failValidation: vi.fn(),
} }));
vi.mock("../../src/integration/integration.draft.js", () => ({ inspectIntegrationDraft: vi.fn() }));
vi.mock("../../src/integration/application.service.js", () => ({ applicationService: {
  requireVerified: vi.fn(),
} }));
vi.mock("../../src/integration/integration.service.js", () => ({ integrationService: {
  prepare: vi.fn(), approve: vi.fn(), list: vi.fn(), resolve: vi.fn(),
} }));
vi.mock("../../src/integration/integration.repo.js", () => ({ integrationRepo: {
  create: vi.fn(),
} }));
vi.mock("../../src/database/transaction.js", () => ({ withTx: vi.fn(async (fn) => fn({})) }));
vi.mock("../../src/integration/integration.builder.js", () => ({ validateIntegrationAcceptance: vi.fn() }));
vi.mock("../../src/integration/integration.source.js", () => ({ validateIntegrationSources: vi.fn() }));

import { candidateRepo } from "../../src/integration/candidate.repo.js";
import { inspectIntegrationDraft } from "../../src/integration/integration.draft.js";
import { applicationService } from "../../src/integration/application.service.js";
import { integrationService } from "../../src/integration/integration.service.js";
import { integrationRepo } from "../../src/integration/integration.repo.js";
import { validateIntegrationAcceptance } from "../../src/integration/integration.builder.js";
import { candidateService } from "../../src/integration/candidate.service.js";
import { integrationController } from "../../src/integration/integration.controller.js";
import { integrationMappingSchema } from "../../src/integration/integration.schema.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const word = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const applicationId = "1f3474c2-f4c2-461d-919d-143749012e27";
const candidateId = "1f3474c2-f4c2-461d-919d-143749012e28";
const owner = address("1");
const target = address("2");
const sourceHash = word("3");
const place = "function placeOrder(uint256 amount,address account,uint256 direction,uint256 bound,uint256 market)";
const close = "function closePosition(uint256 id,address account,uint256 direction,uint256 bound,uint256 market)";
const draft = { entries: [place, close].map((signature) => ({ target, signature,
  source: { sourceHash }, implementation: null, implementationSource: null })) };
const priceArguments = [{ source: "input" as const, path: "direction", choices: { long: "1", short: "2" } },
  { source: "price_bound" as const }, { source: "input" as const, path: "market" }];
const price = { slippagePath: "slippage_bps", directionPath: "direction", maximumDirections: ["long"],
  minimumDirections: ["short"], markets: [`0x${"a".repeat(64)}`] };
const actions = [
  { capability: "place_order", label: "Place order", target, signature: place,
    arguments: [{ source: "input" as const, path: "amount" }, { source: "credit_account" as const }, ...priceArguments],
    marketPath: "market", price, fundingPath: "amount", settlement: "atomic" as const },
  { capability: "close_position", label: "Close position", target, signature: close,
    arguments: [{ source: "input" as const, path: "id" }, { source: "credit_account" as const }, ...priceArguments],
    marketPath: "market", price, settlement: "atomic" as const },
];
const mapping = { applicationId, category: "perps" as const, versionId: word("4"),
  codeHash: word("5"), settlementAsset: address("6"), actions,
  verifiedSources: [{ target, sourceHash }] };
const suite = sampleSuite({ versionId: mapping.versionId, manifestHash: mapping.codeHash });
const acceptance = { suite, evidenceHash: suiteHash(suite), activeCreditId: word("8"), recoveredCreditId: word("9"),
  actionTransactions: { place_order: { creditId: word("9"), txHash: word("a") },
    close_position: { creditId: word("8"), txHash: word("b") } },
  recoveryTxHashes: [word("c")], repaymentTxHash: word("d") };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(candidateRepo.beginValidation).mockResolvedValue({ status: "validating" } as never);
  vi.mocked(applicationService.requireVerified).mockResolvedValue({ id: applicationId,
    owner, origin: "https://trade.example.org", chainId: 143 });
  vi.mocked(inspectIntegrationDraft).mockResolvedValue(draft as never);
});

describe("integration candidate lifecycle", () => {
  it("requires both placement and closure for a perps mapping", () => {
    expect(integrationMappingSchema.safeParse({ ...mapping, actions: [actions[0]] }).success).toBe(false);
    expect(integrationMappingSchema.safeParse(mapping).success).toBe(true);
    expect(integrationMappingSchema.safeParse({ ...mapping,
      actions: actions.map((action) => ({ ...action, price: undefined })) }).success).toBe(false);
  });

  it("stores only a draft after reading an application's own sample", async () => {
    const created = await candidateService.create({ applicationId, entries: [{ target,
      codeHash: word("e"), signature: place, txHash: word("f") }] }, owner);
    expect(created.status).toBe("mapping");
    expect(candidateRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      id: created.id, applicationId, owner, status: "mapping", draft,
    }));
    expect(integrationService.approve).not.toHaveBeenCalled();
  });

  it("rejects capability mappings not present in imported sample transactions", async () => {
    vi.mocked(candidateRepo.get).mockResolvedValue({ applicationId, owner, status: "mapping", draft } as never);
    await expect(candidateService.map(candidateId, owner, { ...mapping,
      actions: [{ ...actions[0]!, signature: "function steal(address account)" }, actions[1]!] }))
      .rejects.toThrow("integration-mapping-not-observed");
    expect(candidateRepo.setMapping).not.toHaveBeenCalled();
  });

  it("keeps proposed mappings inactive until real action and recovery evidence passes", async () => {
    vi.mocked(candidateRepo.get).mockResolvedValueOnce({ applicationId, owner, status: "mapping", draft } as never)
      .mockResolvedValue({ applicationId, owner, status: "ready_to_test", mapping, draft } as never);
    vi.mocked(candidateRepo.setMapping).mockResolvedValue({ status: "ready_to_test" } as never);
    vi.mocked(candidateRepo.setProposal).mockResolvedValue({ status: "security_review" } as never);
    await expect(candidateService.map(candidateId, owner, mapping)).resolves.toEqual({
      id: candidateId, status: "ready_to_test",
    });
    vi.mocked(validateIntegrationAcceptance).mockRejectedValueOnce(new Error("integration-recovery-evidence-invalid"));
    await expect(candidateService.evidence(candidateId, owner, acceptance))
      .rejects.toThrow("integration-recovery-evidence-invalid");
    expect(candidateRepo.setProposal).not.toHaveBeenCalled();
    await expect(candidateService.evidence(candidateId, owner, acceptance))
      .resolves.toEqual({ id: candidateId, status: "security_review" });
  });

  it("rejects concurrent validation and releases failed validation for retry", async () => {
    vi.mocked(candidateRepo.get).mockResolvedValue({ applicationId, owner, status: "validating", mapping, draft } as never);
    vi.mocked(candidateRepo.beginValidation).mockResolvedValueOnce(null);
    await expect(candidateService.evidence(candidateId, owner, acceptance)).rejects.toThrow("integration-validation-busy");
    expect(candidateRepo.setProposal).not.toHaveBeenCalled();
    vi.mocked(validateIntegrationAcceptance).mockRejectedValueOnce(new Error("integration-assertion-failed"));
    await expect(candidateService.evidence(candidateId, owner, acceptance)).rejects.toThrow("integration-assertion-failed");
    expect(candidateRepo.failValidation).toHaveBeenCalledWith(candidateId, expect.any(String), "integration-assertion-failed");
  });

  it("publishes only an unchanged reviewed candidate", async () => {
    vi.mocked(candidateRepo.get).mockResolvedValue({ applicationId, owner, status: "security_review",
      draft, proposal: { ...mapping, acceptance } } as never);
    vi.mocked(integrationService.prepare).mockResolvedValue({ versionId: mapping.versionId,
      appToken: "tbk_test", doc: { versionId: mapping.versionId } } as never);
    vi.mocked(candidateRepo.activate).mockResolvedValue({ status: "active" } as never);
    await expect(candidateService.publish(candidateId, address("a"))).resolves.toEqual({
      candidateId, versionId: mapping.versionId, appToken: "tbk_test",
    });
    expect(candidateRepo.activate).toHaveBeenCalledWith(candidateId, address("a"), expect.anything());
    expect(integrationRepo.create).toHaveBeenCalledWith({ versionId: mapping.versionId }, expect.anything());
  });

  it("requires an admin wallet to publish", async () => {
    const req = { body: { candidateId }, user: { wallet: owner } } as unknown as FastifyRequest;
    await expect(integrationController.approve(req)).rejects.toThrow("permission-denied");
    expect(integrationService.approve).not.toHaveBeenCalled();
  });

  it("lets only the owner resume a candidate", async () => {
    vi.mocked(candidateRepo.get).mockResolvedValue({ applicationId, owner, status: "mapping", draft } as never);
    await expect(candidateService.details(candidateId, owner)).resolves.toMatchObject({
      id: candidateId, applicationId, status: "mapping", draft,
    });
    await expect(candidateService.details(candidateId, address("b")))
      .rejects.toThrow("integration-candidate-unavailable");
  });
});
