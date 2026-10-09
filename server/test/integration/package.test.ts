import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";
import { addr, word } from "../../../packages/sdk/test/plugin.fixture.js";
import { standardDefinition as definition } from "../../../packages/sdk/test/use-case.fixture.js";
import { use_case_configuration } from "@termbook/sdk";
import { sampleSuite } from "./suite.fixture.js";
import { suiteHash } from "../../src/integration/integration.suite.js";

vi.mock("../../src/config/env.js", () => ({ env: { core: `0x${"1".repeat(40)}`, monadChainId: 143 } }));
vi.mock("../../src/integration/package.model.js", () => ({ PackageModel: { create: vi.fn(), findOne: vi.fn(), updateOne: vi.fn() } }));
vi.mock("../../src/integration/application.service.js", () => ({ applicationService: { requireVerified: vi.fn() } }));
vi.mock("../../src/integration/integration.service.js", () => ({ integrationService: { prepare: vi.fn(), resolve: vi.fn() } }));
vi.mock("../../src/integration/integration.repo.js", () => ({ integrationRepo: { create: vi.fn() } }));
vi.mock("../../src/database/transaction.js", () => ({ withTx: vi.fn(async (fn) => fn({})) }));
vi.mock("../../src/integration/integration.builder.js", () => ({ validateIntegrationAcceptance: vi.fn() }));
vi.mock("../../src/integration/integration.source.js", () => ({ validateIntegrationSources: vi.fn() }));
vi.mock("../../src/integration/platform.service.js", () => ({ platformService: { source: vi.fn(), useCase: vi.fn() } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
import { monadClient } from "../../src/chain/monad.client.js";
import { PackageModel } from "../../src/integration/package.model.js";
import { platformService } from "../../src/integration/platform.service.js";
import { integrationService } from "../../src/integration/integration.service.js";
import { integrationRepo } from "../../src/integration/integration.repo.js";
import { validateIntegrationAcceptance } from "../../src/integration/integration.builder.js";
import { packageService } from "../../src/integration/package.service.js";

const applicationId = "1f3474c2-f4c2-461d-919d-143749012e27";
const owner = addr("b");
const chain = { getChainId: vi.fn(async () => 143), getBlock: vi.fn(async () => ({ number: 1n, hash: word("a") })),
  getBytecode: vi.fn(async () => "0x1234"), getStorageAt: vi.fn(async () => word("0")),
  readContract: vi.fn(async ({ functionName, address }: { functionName: string; address: string }) => {
    if (functionName === "integrationRegistry") return addr("a");
    if (functionName === "executionManager") return addr("c");
    if (functionName === "bundles") return [addr("4"), addr("8")];
    const config = use_case_configuration(definition());
    if (functionName === "configurationHashes") return address === addr("8") ? config.reader_hash : address === addr("4") ? config.policy_hash : config.recovery_hash;
    if (functionName === "programHashes") return config.programs[0]!.hash;
    if (functionName === "rule") return config.prices[0]!.rule;
    if (functionName === "amountRules") return Object.values(config.prices[0]!.amount!);
    if (functionName === "dependencyValid") return true;
    return addr("9");
  }) };
beforeEach(() => {
  vi.clearAllMocks(); chain.getBytecode.mockResolvedValue("0x1234");
  vi.mocked(monadClient).mockReturnValue(chain as never);
  vi.mocked(platformService.useCase).mockReturnValue({ chain_id: 143, contracts: definition().contracts, read_program: addr("c") });
  vi.mocked(platformService.source).mockImplementation(async (target) => ({ target, code_hash: keccak256("0x1234"), source_hash: word("a") }));
  vi.mocked(PackageModel.updateOne).mockResolvedValue({ modifiedCount: 1 } as never);
});
async function validated() {
  const d = definition();
  const { package_identity } = await import("../../src/integration/package.service.js");
  const identity = package_identity(d);
  const suite = sampleSuite({ versionId: identity.versionId, manifestHash: identity.hash });
  const acceptance = { suite, evidenceHash: suiteHash(suite), activeCreditId: word("8"), recoveredCreditId: word("9"),
    actionTransactions: { buy: { creditId: word("9"), txHash: word("a") } }, recoveryTxHashes: [word("c")], repaymentTxHash: word("d") };
  const result = await packageService.validate(applicationId, owner, d, acceptance);
  return { result, row: vi.mocked(PackageModel.create).mock.calls[0]![0] as unknown as Record<string, unknown> };
}
const lookup = (row: Record<string, unknown> | null) => vi.mocked(PackageModel.findOne).mockReturnValue({ lean: async () => row } as never);
describe("validated package registration", () => {
  it("runs independent acceptance checks and leaves the package inactive", async () => {
    const { result, row } = await validated();
    expect(result.passed).toBe(true); expect(row.status).toBe("validated");
    expect(validateIntegrationAcceptance).toHaveBeenCalledOnce(); expect(platformService.source).toHaveBeenCalledTimes(definition().pins.length);
    expect(integrationRepo.create).not.toHaveBeenCalled();
    lookup(row); await expect(packageService.register(result.id, applicationId, owner)).resolves.toMatchObject({ status: "awaiting_approval" });
    expect(PackageModel.findOne).toHaveBeenCalledWith({ id: result.id, applicationId, owner });
  });
  it("issues a token only after approval and checks active registrations on resume", async () => {
    const { result, row } = await validated(); row.status = "awaiting_approval"; lookup(row);
    vi.mocked(integrationService.prepare).mockResolvedValue({ doc: { versionId: result.version_id }, appToken: "tbk_test" } as never);
    await expect(packageService.approve(result.id, addr("f"))).resolves.toMatchObject({ status: "active", app_token: "tbk_test" });
    expect(integrationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ packageDefinition: definition() }), expect.anything());
    row.status = "active"; row.appToken = "tbk_test";
    await expect(packageService.register(result.id, applicationId, owner)).resolves.toMatchObject({ app_token: "tbk_test" });
    expect(integrationService.resolve).toHaveBeenCalledWith("tbk_test");
  });
  it("rejects expired, missing and modified validation records", async () => {
    const { result, row } = await validated(); lookup(null);
    await expect(packageService.register(result.id, applicationId, addr("e"))).rejects.toThrow("integration-validation-not-found");
    row.expiresAt = new Date(0); lookup(row);
    await expect(packageService.register(result.id, applicationId, owner)).rejects.toThrow("integration-validation-expired");
    row.expiresAt = new Date(Date.now() + 60_000); row.packageHash = word("f");
    await expect(packageService.register(result.id, applicationId, owner)).rejects.toThrow("integration-validation-binding-invalid");
  });
  it("rejects changed code and failed chain evidence without publishing", async () => {
    const { result, row } = await validated(); lookup(row); chain.getBytecode.mockResolvedValue("0xabcd");
    await expect(packageService.register(result.id, applicationId, owner)).rejects.toThrow("integration-code-changed");
    chain.getBytecode.mockResolvedValue("0x1234");
    vi.mocked(validateIntegrationAcceptance).mockRejectedValueOnce(new Error("integration-assertion-failed"));
    await expect(validated()).rejects.toThrow("integration-assertion-failed");
    expect(integrationRepo.create).not.toHaveBeenCalled();
  });
  it("binds settlement, use case and reviewed sources to the approved artifact", async () => {
    const { result, row } = await validated(); row.status = "awaiting_approval"; lookup(row);
    row.proposal = { ...(row.proposal as Record<string, unknown>), settlementAsset: addr("e") };
    await expect(packageService.approve(result.id, addr("f"))).rejects.toThrow();
    expect(integrationService.prepare).not.toHaveBeenCalled();
  });
});
