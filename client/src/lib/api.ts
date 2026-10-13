import { env } from "./env";

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`Request failed (${status})`);
    this.name = "ApiError";
  }
}

export async function api(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${env.apiUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}
