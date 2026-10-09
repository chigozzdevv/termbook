import { describe, expect, it, vi } from "vitest";
import { useCaseReaderAbi, useCasePolicyAbi, useCaseRecoveryAbi, readProgramAbi, integrationRegistryAbi,
  termbookCoreAbi, healthSourceAbi, appHealthReaderFactoryAbi } from "@termbook/bindings";
import { pluginDefinitionSchema } from "@termbook/schema";
import { decodeFunctionData, type Abi, type PublicClient } from "viem";
import { prepare_use_case, use_case_configuration } from "../src/integration/use-case.js";
import { standardDefinition } from "./use-case.fixture.js";
import { addr, word } from "./plugin.fixture.js";

describe("standard use-case compilation", () => {
  it("builds immutable shared reads, action constraints, recovery and price rules before activation", async () => {
    const d = standardDefinition();
    const client = { getChainId: vi.fn(async () => 143), readContract: vi.fn(async ({ functionName }) => functionName === "core" ? addr("b") : addr("e")) };
    const result = await prepare_use_case(d, { client: client as unknown as PublicClient, core: addr("b"), registry: addr("f"),
      health_source: addr("1"), health_factory: addr("2"), max_health_age: 300 });
    const abis: Record<string, Abi> = { [addr("8")]: useCaseReaderAbi, [addr("4")]: useCasePolicyAbi, [addr("9")]: useCaseRecoveryAbi,
      [addr("c")]: readProgramAbi, [addr("f")]: integrationRegistryAbi, [addr("b")]: termbookCoreAbi,
      [addr("1")]: healthSourceAbi, [addr("2")]: appHealthReaderFactoryAbi };
    const calls = result.calls.map((c) => decodeFunctionData({ abi: abis[c.target.toLowerCase()]!, data: c.data }));
    expect(calls.at(-1)?.functionName).toBe("activate");
    expect(calls.filter((c) => c.functionName === "configure")).toHaveLength(4);
    const config = use_case_configuration(d);
    expect(config.actions[0]?.calls[0]?.words[2]?.kind).toBe(1);
    const policy = decodeFunctionData({ abi: useCasePolicyAbi, data: result.calls.find((call) => call.target === addr("4"))!.data });
    if (policy.functionName !== "configure") throw new Error("policy-call-missing");
    expect(policy.args[1][0]?.calls[0]?.words[2]?.kind).toBe(1);
    expect(config.recovery[0]?.market).toBe(`0x${addr("5").slice(2).padStart(64, "0")}`);
    const changed = structuredClone(d); changed.assessment!.recovery[0]!.minimum_field = 1;
    expect(use_case_configuration(changed).version_id).not.toBe(config.version_id);
    expect(use_case_configuration(changed).recovery_hash).not.toBe(config.recovery_hash);
  });
  it("rejects unpinned reads, self-reported quotes, missing lifecycle reads and unconstrained calls", () => {
    const d = standardDefinition(); d.assessment!.assets[0]!.quote!.target = addr("d");
    expect(() => pluginDefinitionSchema.parse(d)).toThrow();
    const q = standardDefinition(); q.assessment!.assets[0]!.quote!.program.outputs = [0, 0];
    expect(() => pluginDefinitionSchema.parse(q)).toThrow();
    const p = standardDefinition(); p.use_case = "perps";
    expect(() => pluginDefinitionSchema.parse(p)).toThrow();
    const missing = standardDefinition(); missing.assessment!.calls.shift();
    expect(() => use_case_configuration(missing)).toThrow("integration-action-rule-missing");
  });
  it("locks constants to their action rather than sharing another variant's permission", () => {
    const d = standardDefinition(); d.actions[0]!.arguments[2] = { source: "constant", value: addr("2") };
    const rule = use_case_configuration(d).actions[0]!.calls[0]!.words[2]!;
    expect(rule.kind).toBe(0); expect(rule.exact).toBe(`0x${addr("2").slice(2).padStart(64, "0")}`);
    d.actions[0]!.arguments[2] = { source: "borrower" };
    expect(() => use_case_configuration(d)).toThrow("integration-borrower-custody-unsupported");
  });
  it("requires a reviewed guard for proxy dependencies", async () => {
    const d = standardDefinition(); d.pins[0]!.implementation = addr("e"); d.pins[0]!.implementation_code_hash = word("a");
    d.pins[0]!.implementation_slot = word("a"); d.verified_sources[0]!.implementation = addr("e"); d.verified_sources[0]!.implementation_source_hash = word("a");
    const client = { getChainId: vi.fn(async () => 143), readContract: vi.fn(async ({ functionName }) => functionName === "core" ? addr("b") : addr("e")) };
    await expect(prepare_use_case(d, { client: client as unknown as PublicClient, core: addr("b"), registry: addr("f"),
      health_source: addr("1"), health_factory: addr("2"), max_health_age: 300 })).rejects.toThrow("integration-dependency-guard-required");
  });
});
