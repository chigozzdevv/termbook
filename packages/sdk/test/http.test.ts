import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/transport/http.js";

afterEach(() => vi.unstubAllGlobals());
describe("API error handling", () => {
  it("preserves a structured finality error so closure can resume", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "remote-action-authorization-unfinalized",
    }), { status: 503 })));
    await expect(new HttpClient("https://api.example").post("/collateral/actions", {}))
      .rejects.toThrow("remote-action-authorization-unfinalized");
  });
  it("keeps arbitrary upstream text and oversized errors out of SDK errors", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("<html>failure</html>", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "x-" + "a".repeat(5000) }), { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const client = new HttpClient("https://api.example");
    await expect(client.get("/plan")).rejects.toThrow("http-502");
    await expect(client.get("/plan")).rejects.toThrow("http-503");
  });
});
