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

beforeEach(() => {
  env.monadChainId = 143;
  vi.clearAllMocks();
});

afterEach(() => { env.monadChainId = previous; });

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
});
