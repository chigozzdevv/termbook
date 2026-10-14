import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";

const fetchMock = vi.fn<typeof fetch>();
const payload = () => ({ submission_id: randomUUID(), name: " Ada ", email: "ada@example.com",
  reason: "App integration", project: "https://example.com?a=1&b=2", message: "Hello & thank you.\nLet’s talk about SOL / ETH." });

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("CONTACT_FROM_EMAIL", "Termbook <termbook@muwa.io>");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({ id: randomUUID() }), { status: 200 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("public contact route", () => {
  it("accepts the client preflight without sending email", async () => {
    const app = buildApp();
    try {
      const response = await app.inject({ method: "OPTIONS", url: "/contact", headers: {
        origin: "http://127.0.0.1:4178",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      } });
      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
      expect(response.headers["access-control-allow-headers"]).toContain("content-type");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("allows a direct browser submission from the client origin", async () => {
    const app = buildApp();
    try {
      const response = await app.inject({ method: "POST", url: "/contact",
        headers: { origin: "http://127.0.0.1:4178" }, payload: payload() });
      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
      expect(response.json()).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });

  it("sends all fields to the fixed recipient with Reply-To and an idempotency key", async () => {
    const app = buildApp();
    const input = payload();
    try {
      const response = await app.inject({ method: "POST", url: "/contact?source=client", payload: input });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, request] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.resend.com/emails");
      expect(request?.headers).toEqual(expect.objectContaining({ authorization: "Bearer test-key",
        "idempotency-key": `contact/${input.submission_id}` }));
      const email = JSON.parse(String(request?.body));
      expect(email).toMatchObject({ from: "Termbook <termbook@muwa.io>", to: ["termbook@muwa.io"],
        reply_to: input.email, subject: "Termbook enquiry: App integration" });
      for (const value of ["Name: Ada", input.email, input.reason, input.project, input.message]) expect(email.text).toContain(value);
    } finally { await app.close(); }
  });

  it("keeps wallet authorization on protocol routes", async () => {
    const app = buildApp();
    try {
      expect((await app.inject({ method: "POST", url: "/intents", payload: {} })).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it.each([
    { name: "   " }, { email: "invalid" }, { message: "\n  " }, { reason: "unknown" },
    { message: "x".repeat(1201) }, { submission_id: "invalid" }, { to: "attacker@example.com" },
  ])("rejects invalid or unexpected fields without sending: %j", async (change) => {
    const app = buildApp();
    try {
      const response = await app.inject({ method: "POST", url: "/contact", payload: { ...payload(), ...change } });
      expect(response.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("accepts an omitted project", async () => {
    const app = buildApp();
    const input: Record<string, unknown> = payload();
    delete input.project;
    try {
      expect((await app.inject({ method: "POST", url: "/contact", payload: input })).statusCode).toBe(200);
      expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).text).toContain("Not provided");
    } finally { await app.close(); }
  });

  it("rate limits requests by IP even when the query changes", async () => {
    const app = buildApp();
    try {
      for (let i = 0; i < 5; i++) expect((await app.inject({ method: "POST", url: `/contact?attempt=${i}`, payload: payload() })).statusCode).toBe(200);
      const response = await app.inject({ method: "POST", url: "/contact?attempt=6", payload: payload() });
      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBe("900");
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect((await app.inject({ method: "POST", url: "/contact", remoteAddress: "127.0.0.2", payload: payload() })).statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it("rejects oversized and malformed JSON bodies", async () => {
    const app = buildApp();
    try {
      expect((await app.inject({ method: "POST", url: "/contact", payload: { ...payload(), message: "x".repeat(9000) } })).statusCode).toBe(413);
      expect((await app.inject({ method: "POST", url: "/contact", headers: { "content-type": "application/json" }, payload: "{broken" })).statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(["missing-key", "bad-sender", "provider-error", "network-error", "missing-id"])("does not report success for %s", async (failure) => {
    if (failure === "missing-key") vi.stubEnv("RESEND_API_KEY", "");
    if (failure === "bad-sender") vi.stubEnv("CONTACT_FROM_EMAIL", "bad\r\nBcc: other@example.com");
    if (failure === "provider-error") fetchMock.mockResolvedValue(new Response('{"message":"private provider details"}', { status: 403 }));
    if (failure === "network-error") fetchMock.mockRejectedValue(new Error("private connection details"));
    if (failure === "missing-id") fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const app = buildApp();
    try {
      const response = await app.inject({ method: "POST", url: "/contact", payload: payload() });
      expect([502, 503]).toContain(response.statusCode);
      expect(response.body).not.toContain("private");
      expect(response.json()).not.toHaveProperty("ok");
      if (["missing-key", "bad-sender"].includes(failure)) expect(fetchMock).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
