import { setTimeout as delay } from "node:timers/promises";
import { http, type Transport } from "viem";

const schedules = new Map<string, { next: number }>();

export function pacedHttp(url: string, requestsPerSecond = 8): Transport {
  if (!Number.isSafeInteger(requestsPerSecond) || requestsPerSecond < 1 || requestsPerSecond > 1000) throw new Error("rpc-rate-invalid");
  const endpoint = new URL(url).toString();
  const state = schedules.get(endpoint) ?? { next: 0 };
  schedules.set(endpoint, state);
  return (options) => {
    const transport = http(url)(options);
    const request: typeof transport.request = async (parameters, requestOptions) => {
      const now = Date.now();
      const start = Math.max(now, state.next);
      if (start - now > 30_000) throw new Error("rpc-queue-full");
      state.next = start + Math.ceil(1000 / requestsPerSecond);
      if (start > now) await delay(start - now);
      return transport.request(parameters, requestOptions);
    };
    return { ...transport, request };
  };
}
