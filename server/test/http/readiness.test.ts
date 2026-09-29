import { afterEach, describe, expect, it, vi } from "vitest";
import { readiness } from "../../src/http/readiness.js";

const mocks = vi.hoisted(() => ({ state: 1, cursor: vi.fn(), chainId: vi.fn(), block: vi.fn() }));
vi.mock("mongoose", () => ({ default: { connection: { get readyState() { return mocks.state; } } } }));
vi.mock("../../src/chain/indexer.model.js", () => ({ IndexCursorModel: {
  findById: () => ({ lean: mocks.cursor }),
} }));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 143, core: "0xabc" } }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => ({
  getChainId: mocks.chainId, getBlock: mocks.block,
}) }));
afterEach(() => { vi.resetAllMocks(); mocks.state = 1; });

function ready() {
  mocks.cursor.mockResolvedValue({ nextBlock: "1001", indexedAt: new Date() });
  mocks.chainId.mockResolvedValue(143);
  mocks.block.mockResolvedValue({ number: 1000n });
}

describe("service readiness", () => {
  it("requires a current finalized index on the configured chain", async () => {
    ready();
    expect(await readiness()).toBe(true);
    expect(mocks.block).toHaveBeenCalledWith({ blockTag: "finalized" });
    mocks.chainId.mockResolvedValue(1);
    expect(await readiness()).toBe(false);
  });

  it.each([
    { nextBlock: "1001", indexedAt: new Date(0) },
    { nextBlock: "1001", indexedAt: new Date(), integrityFailure: "finalized-reorg" },
    { nextBlock: "500", indexedAt: new Date() },
    null,
  ])("rejects stale, compromised or lagging indexes", async (cursor) => {
    ready();
    mocks.cursor.mockResolvedValue(cursor);
    expect(await readiness()).toBe(false);
  });

  it("rejects a disconnected database before accessing the chain", async () => {
    ready(); mocks.state = 0;
    expect(await readiness()).toBe(false);
    expect(mocks.block).not.toHaveBeenCalled();
  });
});
