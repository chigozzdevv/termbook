import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ resolveTxt: vi.fn() }));
vi.mock("../../src/integration/application.repo.js", () => ({ applicationRepo: {
  create: vi.fn(), get: vi.fn(), verify: vi.fn(),
} }));

import { resolveTxt } from "node:dns/promises";
import { applicationRepo } from "../../src/integration/application.repo.js";
import { applicationService } from "../../src/integration/application.service.js";
import { env } from "../../src/config/env.js";

const owner = `0x${"11".repeat(20)}`;
const previous = env.monadChainId;
const previousLocal = { origins: env.localAppOrigins, admins: env.adminWallets };

beforeEach(() => {
  env.monadChainId = 143;
  env.localAppOrigins = []; env.adminWallets = [];
  vi.clearAllMocks();
});

afterEach(() => { env.monadChainId = previous; env.localAppOrigins = previousLocal.origins;
  env.adminWallets = previousLocal.admins; vi.unstubAllEnvs(); });

describe("application origin admission", () => {
  it("binds an owner to a public origin with a DNS challenge", async () => {
    const result = await applicationService.register({ name: "Test App", origin: "https://trade.example.org",
      chainId: 143 }, owner);
    expect(result.verification.record).toBe("_termbook.trade.example.org");
    expect(result.verification.value).toMatch(/^termbook=[a-f0-9]{64}$/);
    expect(applicationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      id: result.id, origin: "https://trade.example.org", owner,
    }));
  });

  it("rejects origins that could target local infrastructure", async () => {
    for (const origin of ["http://trade.example.org", "https://127.0.0.1", "https://localhost",
      "https://trade.example.org:444", "https://trade.example.org/path", "https://app.local"]) {
      await expect(applicationService.register({ name: "Test App", origin, chainId: 143 }, owner))
        .rejects.toThrow("application-origin-invalid");
    }
    expect(applicationRepo.create).not.toHaveBeenCalled();
  });

  it("requires the owner and current DNS proof before verification", async () => {
    vi.mocked(applicationRepo.get).mockResolvedValue({ owner, origin: "https://trade.example.org",
      challenge: "abc", challengeExpiresAt: new Date(Date.now() + 60_000), chainId: 143 } as never);
    await expect(applicationService.verify("app-id", `0x${"22".repeat(20)}`))
      .rejects.toThrow("application-not-found");
    vi.mocked(resolveTxt).mockResolvedValue([["termbook=wrong"]]);
    await expect(applicationService.verify("app-id", owner)).rejects.toThrow("application-origin-unverified");
    vi.mocked(resolveTxt).mockResolvedValue([["termbook=", "abc"]]);
    vi.mocked(applicationRepo.verify).mockResolvedValue({ verifiedAt: new Date() } as never);
    await expect(applicationService.verify("app-id", owner)).resolves.toEqual({ id: "app-id", status: "verified" });
    expect(resolveTxt).toHaveBeenCalledWith("_termbook.trade.example.org");
  });

  it("rechecks DNS before publication", async () => {
    vi.mocked(applicationRepo.get).mockResolvedValue({ owner, origin: "https://trade.example.org",
      challenge: "abc", verifiedAt: new Date(), chainId: 143 } as never);
    vi.mocked(resolveTxt).mockResolvedValue([["termbook=wrong"]]);
    await expect(applicationService.requireVerified("app-id", undefined, true))
      .rejects.toThrow("application-origin-unverified");
    vi.mocked(resolveTxt).mockResolvedValue([["termbook=abc"]]);
    await expect(applicationService.requireVerified("app-id", owner, true))
      .resolves.toMatchObject({ origin: "https://trade.example.org", owner });
  });

  it("resumes registration only for its owner", async () => {
    vi.mocked(applicationRepo.get).mockResolvedValue({ name: "Test App", owner,
      origin: "https://trade.example.org", challenge: "abc", chainId: 143,
      challengeExpiresAt: new Date(Date.now() + 60_000) } as never);
    await expect(applicationService.details("app-id", owner)).resolves.toMatchObject({
      status: "draft", verification: { record: "_termbook.trade.example.org", value: "termbook=abc" },
    });
    await expect(applicationService.details("app-id", `0x${"22".repeat(20)}`))
      .rejects.toThrow("application-not-found");
  });

  it("allows explicitly configured testnet loopback origins only for an admin owner", async () => {
    env.monadChainId = 10143; env.localAppOrigins = ["http://127.0.0.1:3000"]; env.adminWallets = [owner];
    const result = await applicationService.register({ name: "Local Kuru", origin: env.localAppOrigins[0]!, chainId: 10143 }, owner);
    expect(result.verification).toMatchObject({ method: "local_operator" });
    await expect(applicationService.register({ name: "Local Kuru", origin: env.localAppOrigins[0]!, chainId: 10143 }, `0x${"22".repeat(20)}`))
      .rejects.toThrow("application-local-owner-required");
    vi.mocked(applicationRepo.get).mockResolvedValue({ owner, origin: env.localAppOrigins[0], challenge: "abc",
      challengeExpiresAt: new Date(Date.now() + 60_000), chainId: 10143 } as never);
    vi.mocked(applicationRepo.verify).mockResolvedValue({ verifiedAt: new Date() } as never);
    await expect(applicationService.verify(result.id, owner)).resolves.toEqual({ id: result.id, status: "verified" });
    expect(resolveTxt).not.toHaveBeenCalled();
  });

  it("revokes local app admission when the allowance or admin ownership is removed", async () => {
    env.monadChainId = 10143; env.localAppOrigins = ["http://localhost:3000"]; env.adminWallets = [owner];
    vi.mocked(applicationRepo.get).mockResolvedValue({ owner, origin: env.localAppOrigins[0], challenge: "abc",
      verifiedAt: new Date(), chainId: 10143 } as never);
    await expect(applicationService.requireVerified("app-id", owner, true)).resolves.toMatchObject({ owner });
    env.adminWallets = [];
    await expect(applicationService.requireVerified("app-id", owner)).rejects.toThrow("application-local-owner-required");
    env.adminWallets = [owner]; env.localAppOrigins = [];
    await expect(applicationService.requireVerified("app-id", owner)).rejects.toThrow("application-origin-invalid");
  });

  it("never permits loopback origin admission on mainnet or in production", async () => {
    env.localAppOrigins = ["http://localhost:3000"]; env.adminWallets = [owner];
    await expect(applicationService.register({ name: "Local", origin: env.localAppOrigins[0]!, chainId: 143 }, owner))
      .rejects.toThrow("application-origin-invalid");
    env.monadChainId = 10143; vi.stubEnv("NODE_ENV", "production");
    await expect(applicationService.register({ name: "Local", origin: env.localAppOrigins[0]!, chainId: 10143 }, owner))
      .rejects.toThrow("application-origin-invalid");
  });
});
