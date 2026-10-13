import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explorerRoute } from "../../src/explorer/explorer.route.js";
import { explorerRepo } from "../../src/explorer/explorer.repo.js";
import { houseRepo } from "../../src/house/house.repo.js";
import { monadClient } from "../../src/chain/monad.client.js";

vi.mock("../../src/explorer/explorer.repo.js", () => ({ explorerRepo: { orderPage: vi.fn(), creation: vi.fn(), intent: vi.fn(), events: vi.fn(), cursor: vi.fn() } }));
vi.mock("../../src/house/house.repo.js", () => ({ houseRepo: { list: vi.fn(), get: vi.fn() } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 10143, core: `0x${"1".repeat(40)}`, collateralMarkets: "[]" } }));
const address = (n: string) => `0x${n.repeat(40)}` as `0x${string}`;
const word = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;
const id = word("a"), intent = word("b"), hash = word("c"), vault = address("2"), token = address("3");
const creation = { creditId: id, block: "5", blockHash: hash, data: { intentId: intent } };
const credit = { borrower: address("4"), house: address("5"), vault, collateralVault: address("6"), collateralAsset: address("0"),
  collateralAmount: 2n * 10n ** 18n, limit: 100_000n, debt: 1n, maturity: 1792000000n, aprBps: 500n, facility: 4, revision: 1n };
let now = 1791900000000;
let getBlock: ReturnType<typeof vi.fn>;
let multicall: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now += 20_000);
  vi.mocked(explorerRepo.cursor).mockResolvedValue({ nextBlock: "11" } as never);
  vi.mocked(explorerRepo.creation).mockResolvedValue(creation as never);
  vi.mocked(explorerRepo.orderPage).mockResolvedValue({ records: [{ id, kind: "credit" }], total: 1, next: null });
  vi.mocked(explorerRepo.events).mockResolvedValue([{ event: "CreditCreated", block: "5", blockHash: hash, txHash: word("d"), logIndex: 0, data: {} }] as never);
  vi.mocked(houseRepo.list).mockResolvedValue([{ house: address("5"), vault, asset: token }] as never);
  getBlock = vi.fn(async ({ blockNumber }: { blockNumber?: bigint }) => ({ number: blockNumber ?? 10n, hash, timestamp: 1791900000n }));
  multicall = vi.fn(async ({ contracts }: { contracts: { functionName: string }[] }) => contracts.map(({ functionName }) => {
    if (functionName === "creditDetails") return credit;
    if (functionName === "collateralSourceChainOf") return 10143n;
    if (functionName === "solanaCollateral" || functionName === "paused") return false;
    if (functionName === "creditDebt") return 100_003n;
    if (functionName === "houseRegistry") return address("7");
    if (functionName === "houses") return [vault, token, address("4"), true];
    if (functionName === "asset") return token;
    if (functionName === "depositsOpen") return true;
    if (functionName === "sharePrice") return 10n ** 18n;
    return 0n;
  }));
  vi.mocked(monadClient).mockReturnValue({ getChainId: async () => 10143, getBlock, multicall,
    readContract: async ({ functionName }: { functionName: string }) => functionName === "symbol" ? "USDC" : 6 } as never);
});
afterEach(() => vi.useRealTimers());
async function request(path: string) { const app = Fastify(); explorerRoute(app); const response = await app.inject(path); await app.close(); return response; }

describe("Public explorer", () => {
  it("reads debt and House liquidity from one finalized block without exposing database fields", async () => {
    const response = await request("/explorer/orders");
    expect(response.statusCode).toBe(200);
    const row = response.json().records[0];
    expect(row).toMatchObject({ id, intentId: intent, debt: "100003", settlementSymbol: "USDC", settlementDecimals: 6,
      collateral: { amount: "2000000000000000000", symbol: "MON" } });
    expect(row).not.toHaveProperty("_id");
    expect(multicall.mock.calls.every(([request]) => request.blockNumber === 10n)).toBe(true);
    expect(row.events).toHaveLength(1);
    const house = await request("/explorer/houses");
    expect(house.statusCode).toBe(200);
    expect(house.json()[0]).toMatchObject({ house: address("5"), asset: token, availableCash: "0", active: true, decimals: 6 });
  });
  it("resolves a request ID to its actual indexed credit", async () => {
    const response = await request(`/explorer/orders/${intent}`);
    expect(response.json()).toMatchObject({ id, intentId: intent, kind: "credit" });
  });
  it("returns a genuine empty result when the index has no credits or requests", async () => {
    vi.mocked(explorerRepo.orderPage).mockResolvedValue({ records: [], total: 0, next: null });
    const response = await request("/explorer/orders");
    expect(response.statusCode).toBe(200); expect(response.json().records).toEqual([]);
  });
  it("returns 404 for unknown IDs and rejects malformed parameters", async () => {
    vi.mocked(explorerRepo.creation).mockResolvedValue(null);
    vi.mocked(explorerRepo.intent).mockResolvedValue(null);
    expect((await request(`/explorer/orders/${id}`)).statusCode).toBe(404);
    expect((await request("/explorer/orders/not-an-id")).statusCode).toBe(400);
    expect((await request("/explorer/orders?cursor=bad")).statusCode).toBe(400);
  });
  it("refuses noncanonical creation events, unfinalized events and an index integrity failure", async () => {
    getBlock.mockResolvedValue({ number: 10n, hash: word("f"), timestamp: 1791900000n });
    expect((await request(`/explorer/orders/${id}`)).statusCode).toBe(503);
    getBlock.mockResolvedValue({ number: 10n, hash, timestamp: 1791900000n });
    vi.mocked(explorerRepo.events).mockResolvedValue([{ event: "Drawn", block: "11" }] as never);
    expect((await request(`/explorer/orders/${id}`)).statusCode).toBe(503);
    vi.mocked(explorerRepo.cursor).mockResolvedValue({ integrityFailure: "changed" } as never);
    expect((await request("/explorer/orders")).statusCode).toBe(503);
    vi.mocked(explorerRepo.cursor).mockResolvedValue(null);
    expect((await request("/explorer/orders")).statusCode).toBe(503);
  });
  it("bounds page responses and passes the cursor to the database reader", async () => {
    const response = await request(`/explorer/orders?cursor=${word("1")}`);
    expect(response.statusCode).toBe(200);
    expect(explorerRepo.orderPage).toHaveBeenCalledWith(word("1"));
  });
});
