import { beforeEach, describe, expect, it, vi } from "vitest";
import { quoteService } from "../../src/quote/quote.service.js";
import { quoteRepo } from "../../src/quote/quote.repo.js";
import { intentRepo } from "../../src/intent/intent.repo.js";
import { houseRepo } from "../../src/house/house.repo.js";
import { monadClient } from "../../src/chain/monad.client.js";

vi.mock("../../src/quote/quote.repo.js", () => ({ quoteRepo: { list: vi.fn() } }));
vi.mock("../../src/intent/intent.repo.js", () => ({ intentRepo: { get: vi.fn() } }));
vi.mock("../../src/house/house.repo.js", () => ({ houseRepo: { get: vi.fn() } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/config/env.js", () => ({ env: { core: `0x${"9".repeat(40)}` } }));

const address = (digit: string) => `0x${digit.repeat(40)}`;
const borrower = address("1");
const asset = address("2");
const vault = address("3");
const bundleId = `0x${"a".repeat(64)}`;

beforeEach(() => vi.clearAllMocks());

describe("offer admission", () => {
  it("shows only Houses active in the finalized registry with the matching vault asset", async () => {
    const now = Math.floor(Date.now() / 1000);
    const first = address("4");
    const second = address("5");
    vi.mocked(intentRepo.get).mockResolvedValue({ borrower, settlementAsset: asset, bundleId,
      duration: 3600, actionFunding: "100", expiresAt: now + 600, used: false } as never);
    vi.mocked(quoteRepo.list).mockResolvedValue([first, second].map((house, index) => ({
      quoteId: `q_${index}`, house, vault, borrower, settlementAsset: asset, bundleId, limit: "200",
      originationFee: "0", aprBps: index === 0 ? 100 : 200, commitmentFeeBps: 0,
      expiry: now + 300, setupDeadline: now + 3600, maturity: now + 7200,
    })) as never);
    vi.mocked(houseRepo.get).mockImplementation(async (house) => ({ house, vault, asset, active: true } as never));
    const readContract = vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly string[] }) => {
      if (functionName === "houseRegistry") return address("6");
      if (functionName === "isActiveHouse") return args?.[0] === second;
      if (functionName === "asset") return asset;
      if (functionName === "policies") return [1n, 1_000n, 3600n, 86400n, 1_000n, 100n, 100n,
        15_000n, 13_000n, 12_000n, 11_500n, 11_000n, true, true];
      throw new Error("unexpected-read");
    });
    vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 123n }), readContract } as never);
    const offers = await quoteService.offers("intent");
    expect(offers.map((offer) => offer.house)).toEqual([second]);
    expect(offers[0]?.riskTerms).toMatchObject({ initialBps: "15000", liquidationBps: "11000" });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "isActiveHouse", blockNumber: 123n }));
  });
});
