export class HttpClient {
  base: string;

  constructor(base: string) {
    this.base = base.replace(/\/$/, "");
  }

  async get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, { headers });
    if (!res.ok) throw new Error(`http-${res.status}`);
    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    });
    if (!res.ok) throw new Error(`http-${res.status}`);
    return res.json() as Promise<T>;
  }
}
