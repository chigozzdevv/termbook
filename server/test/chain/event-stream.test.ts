import { afterEach, describe, expect, it, vi } from "vitest";
import { streamEvents } from "../../src/chain/monad.client.js";

const chain = vi.hoisted(() => ({ getBlock: vi.fn(), getLogs: vi.fn() }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(),
  createPublicClient: () => ({ ...chain, extend: () => chain }) }));
afterEach(() => vi.resetAllMocks());

async function collect(from: bigint, step: bigint) {
  const events = [];
  for await (const event of streamEvents(from, step)) events.push(event);
  return events;
}

describe("finalized event ranges", () => {
  it("includes the final block without overlapping batch boundaries", async () => {
    chain.getBlock.mockResolvedValue({ number: 5n });
    chain.getLogs.mockResolvedValue([]);
    await collect(0n, 2n);
    expect(chain.getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
    expect(chain.getLogs.mock.calls.map(([range]) => [range.fromBlock, range.toBlock]))
      .toEqual([[0n, 1n], [2n, 3n], [4n, 5n]]);
  });

  it("propagates an RPC gap instead of advancing past missing events", async () => {
    chain.getBlock.mockResolvedValue({ number: 5n });
    chain.getLogs.mockRejectedValue(new Error("rpc-unavailable"));
    await expect(collect(0n, 2n)).rejects.toThrow("rpc-unavailable");
    expect(chain.getLogs).toHaveBeenCalledTimes(1);
  });

  it("rejects zero-size and negative ranges", async () => {
    await expect(collect(0n, 0n)).rejects.toThrow("event-range-invalid");
    await expect(collect(-1n, 1n)).rejects.toThrow("event-range-invalid");
    expect(chain.getLogs).not.toHaveBeenCalled();
  });
});
