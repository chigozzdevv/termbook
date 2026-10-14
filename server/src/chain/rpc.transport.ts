import { http, type Transport } from "viem";
import { AsyncLocalStorage } from "node:async_hooks";
import { reserveRpcBudget } from "./rpc.budget.js";

type Pending = { queuedAt: number; priority: number; order: number; run(): void; reject(error: Error): void };
type Schedule = { next: number; counter: number; queue: Pending[]; timer?: ReturnType<typeof setTimeout>; unavailableUntil?: number };
const schedules = new Map<string, Schedule>();
const readScope = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withRpcReadScope<T>(read: () => Promise<T>): Promise<T> {
  return readScope.run(new Map(), read);
}

export function isRpcUnavailable(error: unknown): boolean {
  const visited = new Set<unknown>();
  for (let cause = error; cause && typeof cause === "object" && !visited.has(cause);) {
    visited.add(cause);
    const value = cause as { name?: string; message?: string; code?: number; status?: number; cause?: unknown };
    if (["HttpRequestError", "TimeoutError", "SocketClosedError"].includes(value.name ?? "")
      || value.status === 429 || (value.status ?? 0) >= 500
      || [-32605, -32007].includes(value.code ?? 0) && /rate limit|request.*limit/i.test(value.message ?? "")
      || /^rpc-(queue-full|budget-unavailable|budget-storage-unavailable)$/.test(value.message ?? "")) return true;
    cause = value.cause;
  }
  return false;
}

export function pacedHttp(url: string, requestsPerSecond = 8, priority = 0, httpOptions?: Parameters<typeof http>[1], readFallback?: { url: string; chainId: number }): Transport {
  if (!Number.isSafeInteger(requestsPerSecond) || requestsPerSecond < 1 || requestsPerSecond > 1000
    || !Number.isInteger(priority) || priority < 0 || priority > 2) throw new Error("rpc-rate-invalid");
  const endpoint = new URL(url).toString();
  if (readFallback && (!Number.isSafeInteger(readFallback.chainId) || readFallback.chainId <= 0
    || !["https:", "http:"].includes(new URL(readFallback.url).protocol) || new URL(readFallback.url).toString() === endpoint)) throw new Error("rpc-fallback-invalid");
  const state = schedules.get(endpoint) ?? { next: 0, counter: 0, queue: [] };
  schedules.set(endpoint, state);
  const step = Math.ceil(1000 / requestsPerSecond);
  const dispatch = (): void => {
    state.timer = undefined;
    const now = Date.now();
    state.queue = state.queue.filter((item) => {
      if (now - item.queuedAt <= 30_000) return true;
      item.reject(new Error("rpc-queue-full")); return false;
    });
    state.queue.sort((a, b) => {
      const rank = (item: Pending) => now - item.queuedAt >= 5_000 ? 3 : item.priority;
      return rank(b) - rank(a) || a.queuedAt - b.queuedAt || a.order - b.order;
    });
    const next = state.queue.shift();
    if (!next) return;
    state.next = now + step;
    next.run();
    schedule();
  };
  const schedule = (): void => {
    if (state.timer !== undefined || !state.queue.length) return;
    if (state.next <= Date.now()) dispatch();
    else state.timer = setTimeout(dispatch, state.next - Date.now());
  };
  return (options) => {
    const transport = http(url, { timeout: 8000, ...httpOptions, retryCount: 0 })(options);
    const retryLimit = httpOptions?.retryCount ?? 3;
    const backup = readFallback ? pacedHttp(readFallback.url, requestsPerSecond, priority, { ...httpOptions, retryCount: 0 })(options) : undefined;
    let verification: Promise<void> | undefined;
    const backupRead: typeof transport.request = async (parameters, requestOptions) => {
      if (!backup || !readFallback) throw new Error("rpc-fallback-unavailable");
      await (verification ??= backup.request({ method: "eth_chainId" }).then((id) => {
        if (typeof id !== "string" || !/^0x[\da-fA-F]+$/.test(id) || BigInt(id) !== BigInt(readFallback.chainId)) throw new Error("rpc-fallback-chain-mismatch");
      }).catch((error: unknown) => { verification = undefined; throw error; }));
      return backup.request(parameters, requestOptions);
    };
    const execute = (async (parameters: Parameters<typeof transport.request>[0], requestOptions?: Parameters<typeof transport.request>[1]) => {
      const read = /^(eth_call|eth_chainId|eth_blockNumber|eth_gasPrice|eth_estimateGas|eth_feeHistory|eth_maxPriorityFeePerGas|eth_get\w+|net_version)$/.test(parameters.method);
      let backupFailed = false;
      const tryBackup = async () => {
        try { return { result: await backupRead(parameters, requestOptions) }; }
        catch (error) {
          if (!isRpcUnavailable(error)) throw error;
          backupFailed = true;
          state.unavailableUntil = 0;
          return undefined;
        }
      };
      for (let attempt = 0; ; attempt++) {
        if (backup && read && !backupFailed && (state.unavailableUntil ?? 0) > Date.now()) {
          const backupResult = await tryBackup();
          if (backupResult) return backupResult.result;
        }
        await new Promise<void>((resolve, reject) => {
          if (state.queue.length >= requestsPerSecond * 30) { reject(new Error("rpc-queue-full")); return; }
          state.queue.push({ queuedAt: Date.now(), priority, order: state.counter++, reject, run: resolve });
          schedule();
        });
        if (backup && read && !backupFailed && (state.unavailableUntil ?? 0) > Date.now()) {
          const backupResult = await tryBackup();
          if (backupResult) return backupResult.result;
        }
        await reserveRpcBudget(url, parameters.method, parameters.params);
        try { return await transport.request(parameters, requestOptions); }
        catch (error) {
          const rate = error as { code?: number; status?: number; details?: string; message?: string };
          const retry = rate?.status === 429 || (rate?.status ?? 0) >= 500
            || [-32605, -32007].includes(rate?.code ?? 0) && /rate limit|request.*limit/i.test(rate.details ?? rate.message ?? "")
            || (error as Error)?.name === "TimeoutError"
            || (error as Error)?.name === "HttpRequestError" && rate.status === undefined;
          if (read && retry && backup && !backupFailed) {
            state.unavailableUntil = Date.now() + 60_000;
            const backupResult = await tryBackup();
            if (backupResult) return backupResult.result;
          }
          if (!read || attempt >= retryLimit || !retry) throw error;
          state.next = Math.max(state.next, Date.now() + 1000 * 2 ** attempt);
          clearTimeout(state.timer); state.timer = undefined; schedule();
        }
      }
    }) as typeof transport.request;
    const request = ((parameters: Parameters<typeof transport.request>[0], requestOptions?: Parameters<typeof transport.request>[1]) => {
      const scope = readScope.getStore();
      const params = parameters.params as unknown[] | undefined;
      const block = params?.[parameters.method === "eth_getStorageAt" ? 2 : 1];
      // Reuse identical state reads only within one check at an explicit block.
      if (!scope || !["eth_call", "eth_getCode", "eth_getStorageAt", "eth_getBalance"].includes(parameters.method)
        || typeof block !== "string" || !/^0x[\da-fA-F]+$/.test(block)) return execute(parameters, requestOptions);
      const key = JSON.stringify([endpoint, parameters]);
      let result = scope.get(key);
      if (!result) {
        result = execute(parameters, requestOptions);
        if (scope.size >= 512) scope.delete(scope.keys().next().value!);
        scope.set(key, result);
        result.catch(() => { if (scope.get(key) === result) scope.delete(key); });
      }
      return result;
    }) as typeof transport.request;
    return { ...transport, request };
  };
}
