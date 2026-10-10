import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, parseAbi } from "viem";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

import { monadClient } from "../../src/chain/monad.client.js";
import { env } from "../../src/config/env.js";
import { validateIntegrationSources, verifyIntegrationSourcePins } from "../../src/integration/integration.source.js";
import { proxyImplementationSlots } from "@termbook/schema";

const target = `0x${"22".repeat(20)}` as const;
const implementation = `0x${"33".repeat(20)}` as const;
const code = "0x1234" as const;
const signature = "function placeOrder(uint256 amount,address account)";
const sourceHash = `0x${createHash("sha256")
  .update(JSON.stringify([["App.sol", "contract App {}"]])).digest("hex")}`;
const action = { capability: "place_order", label: "Place order", target, signature,
  arguments: [{ source: "input" as const, path: "amount", label: "Amount" },
    { source: "credit_account" as const }], settlement: "atomic" as const };
const previous = { monadChainId: env.monadChainId };
let implementationWord = `0x${"00".repeat(32)}`;

beforeEach(() => {
  env.monadChainId = 143;
  implementationWord = `0x${"00".repeat(32)}`;
  vi.mocked(monadClient).mockReturnValue({
    getBlock: async () => ({ number: 100n }), getChainId: async () => 143,
    getBytecode: async () => code,
    getStorageAt: async ({ slot }: { slot: string }) => slot.endsWith("382bbc")
      ? implementationWord : `0x${"00".repeat(32)}`,
  } as never);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({
    runtimeMatch: "exact_match", chainId: "143", address: new URL(url).pathname.split("/").at(-1),
    matchId: "1", runtimeBytecode: { onchainBytecode: code },
    compilation: { compilerVersion: "v0.8.24", fullyQualifiedName: "App.sol:App" },
    sources: { "App.sol": { content: "contract App {}" } }, abi: parseAbi([signature]),
  }), { status: 200 })));
});

afterEach(() => {
  Object.assign(env, previous);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("integration source admission", () => {
  it("pins the reviewed source and rejects a later proxy change", async () => {
    const pins = await validateIntegrationSources([action], [{ target, sourceHash }]);
    expect(pins).toMatchObject([{ target, codeHash: keccak256(code), sourceHash, implementation: null }]);
    expect(await verifyIntegrationSourcePins(pins)).toBe(true);
    implementationWord = `0x${"00".repeat(12)}${"33".repeat(20)}`;
    expect(await verifyIntegrationSourcePins(pins)).toBe(false);
  });

  it("rejects a reviewed hash that differs from the verified source", async () => {
    await expect(validateIntegrationSources([action], [{ target,
      sourceHash: `0x${"ff".repeat(32)}` }])).rejects.toThrow("integration-source-evidence-invalid");
  });

  it("requires the exact proxy implementation in the review evidence", async () => {
    implementationWord = `0x${"00".repeat(12)}${"33".repeat(20)}`;
    await expect(validateIntegrationSources([action], [{ target, sourceHash }]))
      .rejects.toThrow("integration-source-evidence-invalid");
    const pins = await validateIntegrationSources([action], [{ target, sourceHash,
      implementation, implementationSourceHash: sourceHash }]);
    expect(pins).toMatchObject([{ implementation, implementationCodeHash: keccak256(code) }]);
  });
  it("pins a verified legacy implementation and rejects an undeclared proxy", async () => {
    vi.mocked(monadClient).mockReturnValue({
      getBlock: async () => ({ number: 100n }), getChainId: async () => 143, getBytecode: async () => code,
      getStorageAt: async ({ slot }: { slot: string }) => slot === proxyImplementationSlots[1]
        ? `0x${"00".repeat(12)}${implementation.slice(2)}` : `0x${"00".repeat(32)}`,
    } as never);
    await expect(validateIntegrationSources([action], [{ target, sourceHash }])).rejects.toThrow("integration-source-evidence-invalid");
    const pins = await validateIntegrationSources([action], [{ target, sourceHash, implementation, implementationSourceHash: sourceHash }]);
    expect(pins[0]).toMatchObject({ implementation, implementationSlot: proxyImplementationSlots[1] });
    expect(await verifyIntegrationSourcePins(pins)).toBe(true);
  });
});
