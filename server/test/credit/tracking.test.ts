import { beforeEach, describe, expect, it, vi } from "vitest";
import { creditService } from "../../src/credit/credit.service.js";
import { creditRepo } from "../../src/credit/credit.repo.js";
import { monadClient } from "../../src/chain/monad.client.js";

vi.mock("../../src/credit/credit.repo.js", () => ({ creditRepo: { get: vi.fn(), save: vi.fn(), list: vi.fn() } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/queue/queue.client.js", () => ({ queue: { push: vi.fn() } }));
vi.mock("../../src/config/env.js", () => ({ env: { core: `0x${"9".repeat(40)}` } }));

const creditId = `0x${"a".repeat(64)}`;
const borrower = `0x${"1".repeat(40)}`;
const house = `0x${"2".repeat(40)}`;
const bundleId = `0x${"b".repeat(64)}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 100n, hash: `0x${"f".repeat(64)}` }), readContract: async () => ({
    revision: 7n, facility: 4, debt: 125n, borrower, house, bundleId,
  }) } as never);
  vi.mocked(creditRepo.save).mockImplementation(async (input) => input as never);
});

describe("credit tracking", () => {
  it("records finalized debt and facility when a Credit is tracked", async () => {
    const tracked = await creditService.track({ creditId: creditId.toUpperCase(), borrower, house });
    expect(tracked).toMatchObject({ debt: "125", revision: 7, facility: "ready" });
    expect(creditRepo.save).toHaveBeenCalledWith(expect.objectContaining({ creditId, debt: "125" }));
  });

  it("refreshes a tracked Credit from finalized chain state on read", async () => {
    vi.mocked(creditRepo.get).mockResolvedValue({ creditId } as never);
    expect(await creditService.get(creditId)).toMatchObject({ debt: "125", revision: 7, facility: "ready" });
    vi.mocked(creditRepo.get).mockResolvedValue(null as never);
    expect(await creditService.get(creditId)).toBeNull();
  });
});
