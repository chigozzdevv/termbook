import { afterEach, describe, expect, it, vi } from "vitest";
import { warmForkStorage } from "../../../scripts/testnet-runtime.mjs";

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => undefined) }));

const target = "0x1111111111111111111111111111111111111111";
const keys = [{ target, slot: "0x0" }, { target, slot: "0x1" }];
const fork = { forkUrl: "https://example.invalid", forkBlockNumber: 123 };
const response = (values: unknown) => ({ ok: true, json: async () => values });
function client() {
  return { request: vi.fn(async ({ method }: { method: string }) => method === "anvil_nodeInfo" ? { forkConfig: fork } : undefined) };
}
afterEach(() => vi.unstubAllGlobals());

describe("fork storage prefetch", () => {
  it("retries a transient timeout at the same source block and matches response IDs", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue(response([{ id: 1, result: "0x2" }, { id: 0, result: "0x1" }]));
    vi.stubGlobal("fetch", fetch);
    const chain = client();
    await warmForkStorage(chain, keys);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) {
      const requests = JSON.parse(init.body);
      expect(requests.map((item: { params: string[] }) => item.params[2])).toEqual(["0x7b", "0x7b"]);
    }
    expect(chain.request.mock.calls.slice(1)).toEqual(keys.map(({ target, slot }, i) => [{
      method: "anvil_setStorageAt", params: [target, slot, `0x${String(i + 1).padStart(64, "0")}`],
    }]));
  });

  it("rejects duplicate response IDs before writing storage", async () => {
    const fetch = vi.fn().mockResolvedValue(response([{ id: 0, result: "0x1" }, { id: 0, result: "0x2" }]));
    vi.stubGlobal("fetch", fetch);
    const chain = client();
    await expect(warmForkStorage(chain, keys)).rejects.toThrow("after three attempts");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(chain.request).toHaveBeenCalledTimes(1);
  });

  it("limits archive batches to eight storage reads", async () => {
    const fetch = vi.fn(async (_url, init) => response(JSON.parse(init.body).map(({ id }: { id: number }) => ({ id, result: "0x0" }))));
    vi.stubGlobal("fetch", fetch);
    const progress = vi.fn();
    await warmForkStorage(client(), Array.from({ length: 17 }, (_, i) => ({ target, slot: `0x${i.toString(16)}` })), progress);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).length)).toEqual([8, 8, 1]);
    expect(progress).toHaveBeenLastCalledWith(17, 17);
  });

  it("bounds persistent transport failures without writing assumed zero values", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("unavailable"));
    vi.stubGlobal("fetch", fetch);
    const chain = client();
    await expect(warmForkStorage(chain, keys)).rejects.toThrow("after three attempts");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(chain.request).toHaveBeenCalledTimes(1);
  });
});
