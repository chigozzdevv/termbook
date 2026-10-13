import { http } from "viem";

const rpcBudgets = new Map<string, number>();

export function rpcHttp(url: string) {
  return http(url, { batch: { batchSize: 8, wait: 20 }, retryCount: 3, retryDelay: 1000,
    fetchFn: async (input, init) => {
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const count = Array.isArray(body) ? body.length : 1;
      const now = Date.now(), start = Math.max(now, rpcBudgets.get(url) ?? now), wait = start - now;
      if (wait > 30_000) throw new Error("rpc-busy");
      rpcBudgets.set(url, start + count * 125);
      if (wait) await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) { reject(signal.reason); return; }
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, wait);
        signal?.addEventListener("abort", abort, { once: true });
      });
      return fetch(input, init);
    },
  });
}

export class HttpClient {
  base: string;

  constructor(base: string) {
    this.base = base.replace(/\/$/, "");
  }

  async get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { headers });
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    });
    if (!res.ok) throw await apiError(res);
    return res.json() as Promise<T>;
  }
}

async function apiError(response: Response): Promise<Error> {
  try {
    const body = await response.text();
    if (body.length <= 4096) {
      const value: unknown = JSON.parse(body);
      if (value && typeof value === "object" && "error" in value && typeof value.error === "string"
        && value.error.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value.error)) return new Error(value.error);
    }
  } catch { /* Fall back to the HTTP status. */ }
  return new Error(`http-${response.status}`);
}
