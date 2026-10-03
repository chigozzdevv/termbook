import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pacedHttp } from "../../src/chain/rpc.transport.js";

const request = vi.hoisted(() => vi.fn(async () => "0x1"));
vi.mock("viem", () => ({ http: () => () => ({ request }) }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("RPC request pacing", () => {
  it("shares the rate budget across client instances for one endpoint", async () => {
    const a = pacedHttp("https://rpc.test/shared")({} as never);
    const b = pacedHttp("https://rpc.test/shared")({} as never);
    await a.request({ method: "eth_chainId" });
    const next = b.request({ method: "eth_chainId" });
    await vi.advanceTimersByTimeAsync(124);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not block a different chain endpoint", async () => {
    const a = pacedHttp("https://rpc.test/monad")({} as never);
    const b = pacedHttp("https://rpc.test/ethereum")({} as never);
    await Promise.all([a.request({ method: "eth_chainId" }), b.request({ method: "eth_chainId" })]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
