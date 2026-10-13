import { http, type Transport } from "viem";

type Pending = { queuedAt: number; priority: number; order: number; run(): void; reject(error: Error): void };
type Schedule = { next: number; counter: number; queue: Pending[]; timer?: ReturnType<typeof setTimeout> };
const schedules = new Map<string, Schedule>();

export function pacedHttp(url: string, requestsPerSecond = 8, priority = 0, httpOptions?: Parameters<typeof http>[1]): Transport {
  if (!Number.isSafeInteger(requestsPerSecond) || requestsPerSecond < 1 || requestsPerSecond > 1000
    || !Number.isInteger(priority) || priority < 0 || priority > 2) throw new Error("rpc-rate-invalid");
  const endpoint = new URL(url).toString();
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
      const rank = (item: Pending) => now - item.queuedAt >= 25_000 ? 3 : item.priority;
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
    const transport = http(url, httpOptions)(options);
    const request: typeof transport.request = async (parameters, requestOptions) => {
      for (let attempt = 0; ; attempt++) {
        await new Promise<void>((resolve, reject) => {
          if (state.queue.length >= requestsPerSecond * 30) { reject(new Error("rpc-queue-full")); return; }
          state.queue.push({ queuedAt: Date.now(), priority, order: state.counter++, reject, run: resolve });
          schedule();
        });
        try { return await transport.request(parameters, requestOptions); }
        catch (error) {
          const rate = error as { code?: number; details?: string; message?: string };
          const read = /^(eth_call|eth_chainId|eth_blockNumber|eth_get\w+|net_version)$/.test(parameters.method);
          if (!read || attempt >= 3 || ![-32605, -32007].includes(rate?.code ?? 0)
            || !/rate limit|request.*limit/i.test(rate.details ?? rate.message ?? "")) throw error;
          state.next = Math.max(state.next, Date.now() + 1000 * 2 ** attempt);
          clearTimeout(state.timer); state.timer = undefined; schedule();
        }
      }
    };
    return { ...transport, request };
  };
}
