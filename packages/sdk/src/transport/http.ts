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
