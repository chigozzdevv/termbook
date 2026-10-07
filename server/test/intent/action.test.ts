import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import Fastify from "fastify";
import { registerErrors } from "../../src/http/http.middleware.js";
import { intentController } from "../../src/intent/intent.controller.js";
import { integrationService } from "../../src/integration/integration.service.js";
import { intentService } from "../../src/intent/intent.service.js";

vi.mock("../../src/integration/integration.service.js", () => ({ integrationService: { resolve: vi.fn() } }));
vi.mock("../../src/intent/intent.service.js", () => ({ intentService: { create: vi.fn() } }));

const borrower = `0x${"1".repeat(40)}`;
const versionId = `0x${"a".repeat(64)}`;
const base = { borrower, chainId: 143, asset: `0x${"2".repeat(40)}`, amount: "1000000", duration: 86400 };
const action = { capability: "place_order", params: { margin: "700000000" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(integrationService.resolve).mockResolvedValue({ versionId, use_case: "perps", settlementAsset: `0x${"4".repeat(40)}`,
    actions: [{ capability: "place_order", label: "Place order", target: `0x${"3".repeat(40)}`,
      signature: "function placeOrder(uint256 margin,address account)",
      arguments: [{ source: "input", path: "margin", min: "1" }, { source: "credit_account" }],
      fundingPath: "margin", settlement: "atomic" }] } as never);
});

function request(body: Record<string, unknown>): FastifyRequest {
  return { body, headers: { "x-termbook-app-token": "token" }, user: { wallet: borrower } } as unknown as FastifyRequest;
}

describe("intent action funding", () => {
  it("accepts an explicit matching use case and preserves it", async () => {
    const typedAction = { ...action, use_case: "perps" };
    await intentController.create(request({ ...base, action: typedAction }));
    expect(intentService.create).toHaveBeenCalledWith(expect.objectContaining({ action: typedAction }), versionId, 700000000n, `0x${"4".repeat(40)}`);
  });

  it("rejects a different use case even when the capability name matches", async () => {
    await expect(intentController.create(request({ ...base, action: { ...action, use_case: "spot" } })))
      .rejects.toThrow("action-use-case-mismatch");
    expect(intentService.create).not.toHaveBeenCalled();
  });

  it("reports a use case mismatch as a client error", async () => {
    const app = Fastify();
    registerErrors(app);
    app.post("/intents", async (req) => intentController.create(Object.assign(req, { user: { wallet: borrower } })));
    try {
      const response = await app.inject({ method: "POST", url: "/intents", headers: { "x-termbook-app-token": "token" },
        payload: { ...base, action: { ...action, use_case: "spot" } } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "action-use-case-mismatch" });
      expect(intentService.create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("rejects an unknown use case", async () => {
    await expect(intentController.create(request({ ...base, action: { ...action, use_case: "unknown" } }))).rejects.toThrow();
    expect(integrationService.resolve).not.toHaveBeenCalled();
    expect(intentService.create).not.toHaveBeenCalled();
  });

  it("stores funding derived from the approved capability", async () => {
    await intentController.create(request({ ...base, action }));
    expect(intentService.create).toHaveBeenCalledWith(expect.objectContaining({ action }), versionId, 700000000n, `0x${"4".repeat(40)}`);
  });

  it("rejects a credit cap below the action funding and unknown inputs", async () => {
    await expect(intentController.create(request({ ...base, action, limit: "699999999" })))
      .rejects.toThrow("credit-limit-insufficient");
    await expect(intentController.create(request({ ...base, action: { ...action, params: { margin: "1", target: borrower } } })))
      .rejects.toThrow("action-input-invalid");
    expect(intentService.create).not.toHaveBeenCalled();
  });

  it("rejects values that cannot be encoded for the registered contract call", async () => {
    await expect(intentController.create(request({ ...base, action: { ...action, params: { margin: "abc" } } })))
      .rejects.toThrow("action-input-invalid");
    await expect(intentController.create(request({ ...base, action: { ...action, params: { margin: "115792089237316195423570985008687907853269984665640564039457584007913129639936" } } })))
      .rejects.toThrow("action-input-invalid");
  });
});
