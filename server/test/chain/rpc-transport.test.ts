import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRpcUnavailable, pacedHttp, withRpcReadScope } from "../../src/chain/rpc.transport.js";

const request = vi.hoisted(() => vi.fn(async (_request: { method: string }) => "0x1"));
const backup = vi.hoisted(() => vi.fn(async (input: { method: string }) => input.method === "eth_chainId" ? "0x279f" : "0x2"));
vi.mock("viem", () => ({ http: (url: string) => () => ({ request: url.startsWith("https://backup.test") ? backup : request }) }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("RPC request pacing", () => {
  it("shares identical block-pinned reads within one verification but never across verifications", async () => {
    const client = pacedHttp("https://rpc.test/scope")({} as never);
    const input = { method: "eth_call", params: [{ to: "0x1", data: "0x1234" }, "0x20"] } as const;
    await withRpcReadScope(async () => {
      expect(await Promise.all([client.request(input), client.request(input)])).toEqual(["0x1", "0x1"]);
      expect(await client.request(input)).toBe("0x1");
    });
    expect(request).toHaveBeenCalledTimes(1);
    const fresh = withRpcReadScope(() => client.request(input));
    await vi.advanceTimersByTimeAsync(125);
    await fresh;
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not memoize moving blocks, canonical headers or failed reads", async () => {
    const client = pacedHttp("https://rpc.test/scope-fresh")({} as never);
    const result = withRpcReadScope(async () => {
      for (let n = 0; n < 2; n++) {
        await client.request({ method: "eth_getCode", params: ["0x1", "latest"] });
        await client.request({ method: "eth_getBlockByNumber", params: ["0x20", false] });
      }
      const pinned = { method: "eth_getStorageAt", params: ["0x1", "0x0", "0x20"] } as const;
      request.mockRejectedValueOnce(new Error("failed"));
      await expect(client.request(pinned)).rejects.toThrow("failed");
      expect(await client.request(pinned)).toBe("0x1");
    });
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(request).toHaveBeenCalledTimes(6);
  });
  it("recognizes nested transport failures without classifying validation failures as outages", () => {
    const reset = Object.assign(new Error("HTTP request failed"), { name: "HttpRequestError", cause: { code: "ECONNRESET" } });
    expect(isRpcUnavailable(new Error("integration-not-found", { cause: reset }))).toBe(true);
    expect(isRpcUnavailable(new Error("integration-code-changed"))).toBe(false);
    expect(isRpcUnavailable(Object.assign(new Error("execution reverted"), { code: 3 }))).toBe(false);
  });
  it("checks the backup chain and keeps failed reads off the primary during cooldown", async () => {
    request.mockRejectedValueOnce(Object.assign(new Error("Rate limit"), { code: -32605 }));
    const client = pacedHttp("https://rpc.test/fallback", 8, 0, undefined, { url: "https://backup.test/reads", chainId: 10143 })({} as never);
    const first = client.request({ method: "eth_blockNumber" });
    await vi.advanceTimersByTimeAsync(125);
    expect(await first).toBe("0x2");
    const second = client.request({ method: "eth_getCode", params: ["0x1", "latest"] });
    await vi.advanceTimersByTimeAsync(125);
    expect(await second).toBe("0x2");
    expect(request).toHaveBeenCalledTimes(1);
    expect(backup.mock.calls.map(([input]) => input.method)).toEqual(["eth_chainId", "eth_blockNumber", "eth_getCode"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await client.request({ method: "eth_blockNumber" })).toBe("0x1");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("rejects a backup on another chain", async () => {
    request.mockRejectedValueOnce(Object.assign(new Error("Rate limit"), { code: -32605 }));
    backup.mockResolvedValueOnce("0x1");
    const client = pacedHttp("https://rpc.test/wrong-chain", 8, 0, undefined, { url: "https://backup.test/wrong", chainId: 10143 })({} as never);
    await expect(client.request({ method: "eth_blockNumber" })).rejects.toThrow("rpc-fallback-chain-mismatch");
    expect(backup).toHaveBeenCalledTimes(1);
  });
  it("returns to the primary when the backup times out instead of exhausting retries there", async () => {
    request.mockRejectedValueOnce(Object.assign(new Error("Rate limit"), { code: -32605 }));
    backup.mockRejectedValueOnce(Object.assign(new Error("Timed out"), { name: "TimeoutError" }));
    const client = pacedHttp("https://rpc.test/backup-timeout", 8, 0, undefined, { url: "https://backup.test/timeout", chainId: 10143 })({} as never);
    const result = client.request({ method: "eth_getCode", params: ["0x1", "latest"] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("0x1");
    expect(backup).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("never sends a transaction or a contract revert to the backup", async () => {
    request.mockRejectedValueOnce(Object.assign(new Error("Rate limit"), { code: -32605 }));
    const client = pacedHttp("https://rpc.test/write-primary", 8, 0, undefined, { url: "https://backup.test/writes", chainId: 10143 })({} as never);
    await expect(client.request({ method: "eth_sendRawTransaction", params: ["0x1"] })).rejects.toThrow("Rate limit");
    const revert = Object.assign(new Error("Execution reverted"), { code: 3 });
    request.mockRejectedValueOnce(revert);
    const result = client.request({ method: "eth_call", params: [] }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(125);
    expect(await result).toBe(revert);
    expect(backup).not.toHaveBeenCalled();
  });
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
  it("retries fee and gas estimation reads without resubmitting transactions", async () => {
    const client = pacedHttp("https://rpc.test/fee-limit")({} as never);
    for (const method of ["eth_gasPrice", "eth_estimateGas", "eth_feeHistory", "eth_maxPriorityFeePerGas"]) {
      request.mockRejectedValueOnce(Object.assign(new Error("Rate limit"), { code: -32605 }));
      const result = client.request({ method } as never);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await result).toBe("0x1");
    }
    expect(request).toHaveBeenCalledTimes(8);
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
