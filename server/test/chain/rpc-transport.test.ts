import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pacedHttp } from "../../src/chain/rpc.transport.js";

const request = vi.hoisted(() => vi.fn(async (_request: { method: string }) => "0x1"));
vi.mock("viem", () => ({ http: () => () => ({ request }) }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("RPC request pacing", () => {
  it("prioritizes safety leases without increasing the shared request rate", async () => {
    const ordinary = pacedHttp("https://rpc.test/priority")({} as never);
    const critical = pacedHttp("https://rpc.test/priority", 8, 2)({} as never);
    await ordinary.request({ method: "eth_chainId" });
    const scan = ordinary.request({ method: "eth_blockNumber" });
    const lease = critical.request({ method: "eth_getCode", params: ["0x1", "latest"] });
    await vi.advanceTimersByTimeAsync(125);
    await lease;
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toMatchObject({ method: "eth_getCode" });
    await vi.advanceTimersByTimeAsync(125);
    await scan;
    expect(request.mock.calls[2]?.[0]).toMatchObject({ method: "eth_blockNumber" });
  });
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
  it("keeps ordinary requests from starving under sustained critical traffic", async () => {
    const ordinary = pacedHttp("https://rpc.test/fair", 1)({} as never);
    const critical = pacedHttp("https://rpc.test/fair", 1, 2)({} as never);
    await ordinary.request({ method: "eth_chainId" });
    const scan = ordinary.request({ method: "eth_blockNumber" });
    const leases = Array.from({ length: 26 }, () => critical.request({ method: "eth_chainId" }));
    await vi.advanceTimersByTimeAsync(25_000);
    await scan;
    expect(request.mock.calls[25]?.[0]).toMatchObject({ method: "eth_blockNumber" });
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all(leases);
  });
  it("does not block a different chain endpoint", async () => {
    const a = pacedHttp("https://rpc.test/monad")({} as never);
    const b = pacedHttp("https://rpc.test/ethereum")({} as never);
    await Promise.all([a.request({ method: "eth_chainId" }), b.request({ method: "eth_chainId" })]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
