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
    await vi.advanceTimersByTimeAsync(5_000);
    await scan;
    expect(request.mock.calls[5]?.[0]).toMatchObject({ method: "eth_blockNumber" });
    await vi.advanceTimersByTimeAsync(22_000);
    await Promise.all(leases);
  });
  it("does not block a different chain endpoint", async () => {
    const a = pacedHttp("https://rpc.test/monad")({} as never);
    const b = pacedHttp("https://rpc.test/ethereum")({} as never);
    await Promise.all([a.request({ method: "eth_chainId" }), b.request({ method: "eth_chainId" })]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("backs off the shared endpoint when a provider rejects a read with an RPC rate limit", async () => {
    request.mockRejectedValueOnce(Object.assign(new Error("Rate limit"), { code: -32605 }));
    const a = pacedHttp("https://rpc.test/limited")({} as never);
    const b = pacedHttp("https://rpc.test/limited")({} as never);
    const first = a.request({ method: "eth_call", params: [] });
    await vi.advanceTimersByTimeAsync(0);
    const second = b.request({ method: "eth_chainId" });
    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(126);
    await Promise.all([first, second]);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("bounds rate limit retries and propagates persistent provider failures", async () => {
    const error = Object.assign(new Error("50/second request limit reached"), { code: -32007 });
    request.mockRejectedValue(error);
    const client = pacedHttp("https://rpc.test/persistent")({} as never);
    const result = client.request({ method: "eth_blockNumber" }).catch((value: unknown) => value);
    await vi.advanceTimersByTimeAsync(7000);
    expect(await result).toBe(error);
    expect(request).toHaveBeenCalledTimes(4);
    request.mockResolvedValue("0x1");
  });
  it("does not retry transaction submission or unrelated RPC errors", async () => {
    const rate = Object.assign(new Error("Rate limit"), { code: -32605 });
    request.mockRejectedValueOnce(rate);
    const client = pacedHttp("https://rpc.test/nonretry")({} as never);
    await expect(client.request({ method: "eth_sendRawTransaction", params: ["0x1"] })).rejects.toBe(rate);
    const other = Object.assign(new Error("Execution reverted"), { code: -32605 });
    request.mockRejectedValueOnce(other);
    const result = client.request({ method: "eth_call", params: [] }).catch((value: unknown) => value);
    await vi.advanceTimersByTimeAsync(125);
    expect(await result).toBe(other);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("paces HTTP 429 retries through the same budget", async () => {
    request.mockRejectedValueOnce(Object.assign(new Error("Too many requests"), { status: 429 }));
    const client = pacedHttp("https://rpc.test/http-limit")({} as never);
    const result = client.request({ method: "eth_call", params: [] });
    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("0x1");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
