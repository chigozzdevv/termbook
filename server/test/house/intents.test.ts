import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { houseController } from "../../src/house/house.controller.js";
import { houseRepo } from "../../src/house/house.repo.js";
import { intentService } from "../../src/intent/intent.service.js";
import { monadClient } from "../../src/chain/monad.client.js";

vi.mock("../../src/house/house.repo.js", () => ({ houseRepo: { get: vi.fn() } }));
vi.mock("../../src/intent/intent.service.js", () => ({ intentService: { listOpen: vi.fn() } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/config/env.js", () => ({ env: { core: `0x${"9".repeat(40)}` } }));

const house = `0x${"1".repeat(40)}`;
const manager = `0x${"2".repeat(40)}`;
const vault = `0x${"7".repeat(40)}`;
const asset = `0x${"8".repeat(40)}`;
const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
  if (functionName === "houseRegistry") return `0x${"6".repeat(40)}`;
  if (functionName === "houses") return [vault, asset, manager, true] as const;
  throw new Error("unexpected-read");
});

function request(wallet: string, body: Record<string, unknown>): FastifyRequest {
  return { user: { wallet }, body } as unknown as FastifyRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 123n }), readContract } as never);
});

describe("House intent feed", () => {
  it("returns live intents only to an active registered House", async () => {
    vi.mocked(houseRepo.get).mockResolvedValue({ house, vault, asset, active: true } as never);
    vi.mocked(intentService.listOpen).mockResolvedValue([{ intentId: "intent" }] as never);
    const cursor = { createdAt: "2026-09-24T00:00:00.000Z", id: "a".repeat(24) };
    expect(await houseController.intents(request(house, { house, cursor }))).toEqual([{ intentId: "intent" }]);
    expect(intentService.listOpen).toHaveBeenCalledWith(asset, { createdAt: new Date(cursor.createdAt), id: cursor.id });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "houses", blockNumber: 123n }));
  });

  it("lets the onchain manager discover intents", async () => {
    vi.mocked(houseRepo.get).mockResolvedValue({ house, vault, asset, active: true } as never);
    vi.mocked(intentService.listOpen).mockResolvedValue([{ intentId: "intent" }] as never);
    expect(await houseController.intents(request(manager, { house }))).toEqual([{ intentId: "intent" }]);
  });

  it("rejects unrelated wallets and unregistered Houses", async () => {
    vi.mocked(houseRepo.get).mockResolvedValue({ house, vault, asset, active: true } as never);
    await expect(houseController.intents(request(`0x${"4".repeat(40)}`, { house })))
      .rejects.toThrow("permission-denied");
    vi.mocked(houseRepo.get).mockResolvedValue(null as never);
    await expect(houseController.intents(request(house, { house }))).rejects.toThrow("house-unavailable");
    expect(intentService.listOpen).not.toHaveBeenCalled();
  });

  it("rejects a House no longer active onchain", async () => {
    vi.mocked(houseRepo.get).mockResolvedValue({ house, vault, asset, active: true } as never);
    readContract.mockImplementationOnce(async () => `0x${"6".repeat(40)}` as never)
      .mockImplementationOnce(async () => [vault, asset, manager, false] as never);
    await expect(houseController.intents(request(house, { house }))).rejects.toThrow("house-unavailable");
  });
});
