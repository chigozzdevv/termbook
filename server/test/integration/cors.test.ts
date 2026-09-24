import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

describe("browser SDK transport", () => {
  it("allows the public API and signed requests from an embedded application", async () => {
    const app = buildApp();
    try {
      const preflight = await app.inject({ method: "OPTIONS", url: "/integrations/config",
        headers: { origin: "https://perps.example", "access-control-request-method": "GET" } });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe("*");
      expect(preflight.headers["access-control-allow-headers"]).toContain("x-termbook-signature");
    } finally {
      await app.close();
    }
  });
});
