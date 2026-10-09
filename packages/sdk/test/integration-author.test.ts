import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiAuthorizationMessage } from "@termbook/schema";
import type { PublicClient } from "viem";
import { create_sdk, type ValidationEnvironment } from "../src/integration/author.js";
import { package_integration } from "../src/integration/plugin.js";
import { testPlugin, addr, word } from "./plugin.fixture.js";
import { sampleSuite } from "./integration-suite.fixture.js";
vi.mock("../src/integration/validation.js", () => ({ IntegrationValidationRunner: vi.fn() }));
vi.mock("../src/integration/callbacks.js", () => ({ validate_callbacks: vi.fn() }));
import { IntegrationValidationRunner } from "../src/integration/validation.js";
import { validate_callbacks } from "../src/integration/callbacks.js";
const application_id = "1f3474c2-f4c2-461d-919d-143749012e27";
const validation_id = "1f3474c2-f4c2-461d-919d-143749012e28";
const wallet = { address: addr("b"), signMessage: vi.fn(async () => word("a")), signTypedData: vi.fn() };
const chain = { getChainId: vi.fn(async () => 143), getBytecode: vi.fn(async () => "0x1234"), getStorageAt: vi.fn(async () => word("0")),
  getBlock: vi.fn(async () => ({ number: 1n, hash: word("a") })) };
let response: unknown;
let run = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); run = vi.fn(async (_id, scenario) => scenario({}));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith("/auth/nonce")) {
      const expiresAt = Math.floor(Date.now() / 1000) + 60; const nonce = `${"1".repeat(64)}.${expiresAt}`;
      return new Response(JSON.stringify({ wallet: wallet.address, domain: "api.termbook.org", expiresAt, nonce,
        message: apiAuthorizationMessage("api.termbook.org", wallet.address, nonce, expiresAt, body) }));
    }
    return new Response(JSON.stringify(response));
  }));
});
afterEach(() => vi.unstubAllGlobals());
function environment() {
  const p = testPlugin(), identity = package_integration(p);
  const suite = sampleSuite({ versionId: identity.version_id, manifestHash: identity.hash });
  for (const pin of p.definition.pins) if (!suite.contracts.some((c) => c.target === pin.target)) suite.contracts.push({ target: pin.target, codeHash: pin.code_hash });
  vi.mocked(IntegrationValidationRunner).mockImplementation(() => ({ run, finish: () => ({ suite, evidenceHash: word("a") }) }) as never);
  const context = { format: suite.format, core: suite.core, chainId: suite.chainId, versionId: suite.versionId,
    manifestHash: suite.manifestHash, mode: suite.mode, sourceBlock: suite.sourceBlock, actors: suite.actors, contracts: suite.contracts };
  const env: ValidationEnvironment = { client: chain as unknown as PublicClient, options: { gasLimit: 1_000_000n }, prepare: vi.fn(async () => ({
    context, wallets: [], cases: Object.fromEntries(suite.cases.map((item) => [item.id, async () => {}])), exclusions: [], probes: [],
    lifecycle: { active_credit_id: word("8"), recovered_credit_id: word("9"), action_transactions: {}, recovery_tx_hashes: [], repayment_tx_hash: word("d") },
  })) };
  response = { id: validation_id, passed: true, version_id: identity.version_id, package_hash: identity.hash, failures: [] };
  return { p, env };
}
const sdk = (validation_environment?: ValidationEnvironment) => create_sdk({ application_id, wallet, api_base: "https://api.termbook.org", validation_environment });
describe("SDK integration author flow", () => {
  it("runs the protocol suite and callback checks before signing validation evidence", async () => {
    const { p, env } = environment();
    const result = await sdk(env).integrations.validate({ plugin: p, wallet, amount: 10_000_000n });
    expect(result.id).toBe(validation_id); expect(run.mock.calls.length).toBeGreaterThan(30);
    expect(validate_callbacks).toHaveBeenCalledOnce(); expect(wallet.signMessage).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenLastCalledWith("https://api.termbook.org/integrations/packages/validate", expect.objectContaining({
      headers: expect.objectContaining({ "x-termbook-wallet": wallet.address }),
    }));
  });
  it("rejects missing runtime, incomplete suites and mutation during validation", async () => {
    const { p, env } = environment();
    await expect(sdk().integrations.validate({ plugin: p, wallet, amount: 1n })).rejects.toThrow("integration-validation-environment-unavailable");
    run.mockImplementationOnce(async () => { p.definition.pins[0]!.code_hash = word("e"); });
    await expect(sdk(env).integrations.validate({ plugin: p, wallet, amount: 1n })).rejects.toThrow("integration-definition-changed");
    expect(wallet.signMessage).not.toHaveBeenCalled();
  });
  it("registers by validation ID and returns the token only for an active response", async () => {
    response = { integration_id: validation_id, version_id: word("b"), status: "awaiting_approval" };
    await expect(sdk().integrations.register({ validation_id })).resolves.toMatchObject({ status: "awaiting_approval" });
    response = { integration_id: validation_id, version_id: word("b"), status: "active", app_token: `tbk_${"a".repeat(64)}` };
    await expect(sdk().integrations.status({ validation_id })).resolves.toMatchObject({ app_token: `tbk_${"a".repeat(64)}` });
    response = { integration_id: application_id, version_id: word("b"), status: "active", app_token: "invented" };
    await expect(sdk().integrations.register({ validation_id })).rejects.toThrow("integration-registration-response-invalid");
  });
  it("rejects a nonce challenge bound to another operation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ wallet: wallet.address, nonce: "bad", message: "Sign anything" }))));
    await expect(sdk().integrations.register({ validation_id })).rejects.toThrow("auth-challenge-invalid");
    expect(wallet.signMessage).not.toHaveBeenCalled();
  });
});
