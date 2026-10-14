import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/logging/logger.js";
import Fastify from "fastify";
import { registerErrors } from "../../src/http/http.middleware.js";

afterEach(() => vi.restoreAllMocks());
describe("operational logging", () => {
  it("reports nested RPC outages without exposing provider credentials or disguising reverts", async () => {
    const app = Fastify();
    registerErrors(app);
    app.get("/outage", async () => { throw new Error("private provider", {
      cause: Object.assign(new Error("secret RPC URL"), { name: "HttpRequestError", status: 429 }),
    }); });
    app.get("/revert", async () => { throw Object.assign(new Error("execution reverted"), { code: 3 }); });
    try {
      const result = await app.inject("/outage");
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual({ error: "chain-unavailable" });
      expect((await app.inject("/revert")).statusCode).toBe(500);
    } finally { await app.close(); }
  });
  it("omits credentials, signed transaction bodies, and nested RPC error dumps", () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = Object.assign(new Error("raw transaction secret"), { rawTransaction: "signed-secret", abi: Array(500).fill("ABI") });
    logger.error("keeper-failed", { error: cause, privateKey: "private-secret", raw: "raw-secret", hash: "public-hash",
      reason: "RPC Request failed.\nURL: https://rpc.example/private-secret" });
    const result = write.mock.calls[0]?.[0] as string;
    expect(result).not.toContain("secret");
    expect(result).not.toContain("ABI");
    expect(JSON.parse(result)).toEqual({ level: "error", msg: "keeper-failed", extra: {
      error: { name: "Error" }, privateKey: "[redacted]", raw: "[redacted]", hash: "public-hash", reason: "RPC Request failed.",
    } });
  });
});
