import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth/auth.model.js", () => ({ AuthModel: { create: vi.fn() } }));
import { AuthModel } from "../../src/auth/auth.model.js";
import { authRepo } from "../../src/auth/auth.repo.js";
import { requestLimiter } from "../../src/http/http-limit.js";

beforeEach(() => { vi.clearAllMocks(); });

describe("authentication replay protection", () => {
  it("uses Mongo's unique primary key to consume a signed nonce once", async () => {
    vi.mocked(AuthModel.create).mockResolvedValueOnce({} as never).mockRejectedValueOnce({ code: 11000 });
    expect(await authRepo.consume("wallet", "nonce", 100)).toBe(true);
    expect(await authRepo.consume("wallet", "nonce", 100)).toBe(false);
    expect(AuthModel.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      _id: expect.stringMatching(/^[a-f0-9]{64}$/), expiresOn: new Date(100_000),
    }));
    expect(vi.mocked(AuthModel.create).mock.calls[0]).toEqual(vi.mocked(AuthModel.create).mock.calls[1]);
  });

  it("fails closed when replay storage is unavailable", async () => {
    vi.mocked(AuthModel.create).mockRejectedValueOnce(new Error("database-down"));
    await expect(authRepo.consume("wallet", "nonce", 100)).rejects.toThrow("database-down");
  });

  it("bounds requests and allows a new window after expiry", () => {
    vi.useFakeTimers();
    const allow = requestLimiter(2, 1000);
    expect(allow("ip")).toBe(true);
    expect(allow("ip")).toBe(true);
    expect(allow("ip")).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(allow("ip")).toBe(true);
    vi.useRealTimers();
  });
});
