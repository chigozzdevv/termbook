import { beforeEach, describe, expect, it, vi } from "vitest";
import { monadClient } from "../../src/chain/monad.client.js";
import { integrationRepo } from "../../src/integration/integration.repo.js";
import { integrationService } from "../../src/integration/integration.service.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/integration/integration.repo.js", () => ({ integrationRepo: {
  create: vi.fn(), byTokenHash: vi.fn(), list: vi.fn(),
} }));
vi.mock("../../src/config/env.js", () => ({ env: {
  core: `0x${"1".repeat(40)}`, monadChainId: 143,
  accountFactory: `0x${"2".repeat(40)}`,
  publicApiBase: "https://api.termbook.example", publicRpcUrl: "https://rpc.termbook.example",
  settlementFactory: "",
} }));

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const versionId = `0x${"a".repeat(64)}`;
const codeHash = `0x${"b".repeat(64)}`;

beforeEach(() => {
  vi.clearAllMocks();
  const chain = {
    getBlock: vi.fn(async () => ({ number: 100n })),
    getChainId: vi.fn(async () => 143),
    getBytecode: vi.fn(async () => "0x1234"),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "integrationRegistry") return address("3");
      if (functionName === "healthSource") return address("4");
      if (functionName === "exitVerifierOfBundle") return address("5");
      if (functionName === "riskEngine") return address("6");
      if (functionName === "versions") return [codeHash, true, false];
      if (functionName === "isActive" || functionName === "isReaderActive") return true;
      throw new Error("unexpected-read");
    }),
  };
  vi.mocked(monadClient).mockReturnValue(chain as never);
});

describe("integration app token", () => {
  it("issues a token only for an admitted bundle and stores only its hash", async () => {
    const result = await integrationService.approve({ versionId, codeHash });
    expect(result.appToken).toMatch(/^tbk_[a-f0-9]{64}$/);
    expect(integrationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      versionId, codeHash, tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(JSON.stringify(vi.mocked(integrationRepo.create).mock.calls[0])).not.toContain(result.appToken);
  });

  it("resolves only an active token and returns Core derived risk config", async () => {
    const result = await integrationService.approve({ versionId, codeHash });
    vi.mocked(integrationRepo.byTokenHash).mockResolvedValue({ versionId, codeHash, active: true, frozen: false } as never);
    const resolved = await integrationService.resolve(result.appToken);
    expect(resolved).toMatchObject({ appToken: result.appToken, core: address("1"), riskEngine: address("6"),
      accountFactory: address("2"), chainId: 143 });
    expect(integrationRepo.byTokenHash).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/));
  });

  it("rejects a frozen local integration before returning deployment config", async () => {
    const result = await integrationService.approve({ versionId, codeHash });
    vi.mocked(integrationRepo.byTokenHash).mockResolvedValue({ versionId, codeHash, active: true, frozen: true } as never);
    await expect(integrationService.resolve(result.appToken)).rejects.toThrow("integration-not-found");
  });
});
