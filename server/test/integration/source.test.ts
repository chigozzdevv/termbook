import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, parseAbi, toFunctionSelector } from "viem";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

import { monadClient } from "../../src/chain/monad.client.js";
import { env } from "../../src/config/env.js";
import { clearVerifiedSourceCache, importVerifiedSource, validateIntegrationSources, verifyIntegrationSourcePins } from "../../src/integration/integration.source.js";
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
  clearVerifiedSourceCache();
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
  clearVerifiedSourceCache();
  vi.useRealTimers();
  Object.assign(env, previous);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("integration source admission", () => {
  it("reuses verification while checking each selector and its payable requirement", async () => {
    await Promise.all(Array.from({ length: 8 }, () => importVerifiedSource(143, target, code, null)));
    const allowed = toFunctionSelector(signature);
    await expect(importVerifiedSource(143, target, code, allowed)).resolves.toMatchObject({ sourceHash });
    await expect(importVerifiedSource(143, target, code, allowed, true)).rejects.toThrow("integration-source-selector-mismatch");
    await expect(importVerifiedSource(143, target, code, toFunctionSelector("withdraw(uint256)"))).rejects.toThrow("integration-source-selector-mismatch");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not reuse a source for changed bytecode or another chain", async () => {
    await importVerifiedSource(143, target, code, null);
    await expect(importVerifiedSource(143, target, "0x1235", null)).rejects.toThrow("integration-source-unverified");
    await expect(importVerifiedSource(10143, target, code, null)).rejects.toThrow("integration-source-unverified");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("retries unavailable sources and expires successful verification", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("unavailable"));
    await expect(importVerifiedSource(143, target, code, null)).rejects.toThrow("integration-source-unavailable");
    await importVerifiedSource(143, target, code, null);
    await importVerifiedSource(143, target, code, null);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_001);
    await importVerifiedSource(143, target, code, null);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  function metadataSource(prefix = "60016000", offset = 4) {
    const auxiliary = "a164736f6c634300060c000a";
    const actual = `0x${prefix}${auxiliary}` as const;
    const compiled = `0x60016000a164736f6c634300060b000a`;
    const runtimeBytecode = { onchainBytecode: actual, recompiledBytecode: compiled,
      cborAuxdata: { "1": { value: `0x${compiled.slice(10)}`, offset } },
      transformations: [{ id: "1", offset, type: "replace", reason: "cborAuxdata" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      runtimeMatch: "match", chainId: "143", address: target, matchId: "1", runtimeBytecode,
      compilation: { compilerVersion: "0.6.12", fullyQualifiedName: "App.sol:App" },
      sources: { "App.sol": { content: "contract App {}" } }, abi: parseAbi([signature]),
    }))));
    return { actual, runtimeBytecode };
  }
  it("accepts a verified metadata-only match while pinning the complete live bytecode", async () => {
    const { actual } = metadataSource();
    expect(await importVerifiedSource(143, target, actual, null)).toMatchObject({ runtimeMatch: "match", sourceHash });
  });
  it("rejects executable changes, incorrect metadata offsets and malformed metadata lengths", async () => {
    let source = metadataSource("60026000");
    await expect(importVerifiedSource(143, target, source.actual, null)).rejects.toThrow("integration-source-unverified");
    source = metadataSource("60016000", 2);
    await expect(importVerifiedSource(143, target, source.actual, null)).rejects.toThrow("integration-source-unverified");
    source = metadataSource(); source.runtimeBytecode.onchainBytecode = `${source.actual.slice(0, -4)}0010`;
    await expect(importVerifiedSource(143, target, source.runtimeBytecode.onchainBytecode, null)).rejects.toThrow("integration-source-unverified");
  });
  it("permits only declared immutable substitutions alongside the metadata match", async () => {
    const { runtimeBytecode } = metadataSource();
    const mutable = runtimeBytecode as unknown as { onchainBytecode: string; recompiledBytecode: string;
      cborAuxdata: Record<string, { value: string; offset: number }>;
      transformations: { id: string; offset: number; type: string; reason: string }[];
      immutableReferences?: Record<string, { start: number; length: number }[]> };
    const auxiliary = mutable.cborAuxdata["1"]!;
    mutable.onchainBytecode = `0x60016000${"11".repeat(32)}${mutable.onchainBytecode.slice(10)}`;
    mutable.recompiledBytecode = `0x60016000${"00".repeat(32)}${mutable.recompiledBytecode.slice(10)}`;
    auxiliary.offset = 36; mutable.transformations[0]!.offset = 36;
    mutable.transformations.unshift({ id: "2", offset: 4, type: "replace", reason: "immutable" });
    mutable.immutableReferences = { "2": [{ start: 4, length: 32 }] };
    expect(await importVerifiedSource(143, target, mutable.onchainBytecode as `0x${string}`, null)).toMatchObject({ runtimeMatch: "match" });
    clearVerifiedSourceCache();
    mutable.immutableReferences["2"]![0]!.length = 64;
    await expect(importVerifiedSource(143, target, mutable.onchainBytecode as `0x${string}`, null)).rejects.toThrow("integration-source-unverified");
  });
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
