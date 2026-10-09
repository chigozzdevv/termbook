import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, parseAbi, type PublicClient } from "viem";
import { package_integration, check_state, check_plan } from "../src/integration/plugin.js";
import { verify_definition, implementation_slot } from "../src/integration/pins.js";
import { definition, testPlugin, addr, word } from "./plugin.fixture.js";
const context = { client: {} as PublicClient, credit_id: word("b"), account: addr("2"), block: { number: 1n, hash: word("c") } };
describe("portable integration definitions", () => {
  it("binds the complete definition while keeping callback functions out of the artifact", () => {
    const plugin = testPlugin();
    const first = package_integration(plugin);
    expect(JSON.stringify(first.definition)).not.toContain("read(");
    plugin.definition.pins[0]!.code_hash = word("e");
    expect(package_integration(plugin).version_id).not.toBe(first.version_id);
    expect(first.definition.pins[0]!.code_hash).not.toBe(word("e"));
  });
  it("rejects missing callbacks, uncovered dependencies and mismatched metadata", () => {
    const plugin = testPlugin();
    plugin.name = "Different name";
    expect(() => package_integration(plugin)).toThrow("integration-definition-mismatch");
    plugin.name = plugin.definition.name;
    plugin.definition.pins.pop();
    expect(() => package_integration(plugin)).toThrow();
  });
  it("rejects double counting, foreign custody and reads from another block", () => {
    const holding = { holding_id: "base", asset: addr("5"), amount: 100n, held_at: context.account,
      controlled_by: context.account, withdrawable_now: 100n };
    const state = { block: context.block, holdings: [holding], orders: [], liabilities: [] };
    expect(check_state("spot", state, context)).toEqual(state);
    expect(() => check_state("spot", { ...state, holdings: [holding, { ...holding, holding_id: "other" }] }, context)).toThrow("integration-custody-invalid");
    expect(() => check_state("spot", { ...state, holdings: [{ ...holding, controlled_by: addr("a") }] }, context)).toThrow("integration-custody-invalid");
    expect(() => check_state("spot", { ...state, block: { ...context.block, number: 2n } }, context)).toThrow("integration-state-block-mismatch");
  });
  it("accepts a declared call and rejects an injected target, value or spend claim", () => {
    const d = definition();
    const action = { use_case: "spot" as const, capability: "place_order" as const, params: { market_id: "TOKEN-USDC", direction: "buy" as const,
      order_type: "market" as const, amount: { spend: 100n }, slippage_bps: 50 } };
    const plan = { calls: [{ target: addr("3"), data: encodeFunctionData({ abi: parseAbi([d.actions[0]!.signature]), functionName: "buy",
      args: [100n, 5n, context.account] } as never), value: 0n, spend_asset: addr("6"), spend_amount: 100n }],
      spending: [{ asset: addr("6"), maximum: 100n }], receiving: [{ asset: addr("5"), minimum: 5n, controlled_by: context.account }], completion: { kind: "atomic" as const } };
    const actionContext = { ...context, borrower: addr("1"), action, market: d.markets[0]!, minimum_receive: 5n };
    expect(check_plan(d, action, plan, actionContext)).toEqual(plan);
    expect(() => check_plan(d, action, { ...plan, calls: [{ ...plan.calls[0], target: addr("a") }] }, actionContext)).toThrow("integration-plan-mismatch");
    expect(() => check_plan(d, action, { ...plan, spending: [{ asset: addr("6"), maximum: 101n }] }, actionContext)).toThrow("integration-spend-mismatch");
  });
  it("detects an implementation change even when the proxy bytecode stays the same", async () => {
    const d = definition();
    d.pins[0] = { ...d.pins[0]!, implementation: addr("8"), implementation_code_hash: d.pins[0]!.code_hash, implementation_slot };
    const client = { getChainId: vi.fn(async () => 143), getBlock: vi.fn(async () => context.block),
      getBytecode: vi.fn(async () => "0x1234"), getStorageAt: vi.fn(async ({ address }) => address === addr("3") ? `0x${"0".repeat(24)}${addr("8").slice(2)}` : word("0")) };
    await expect(verify_definition(client as unknown as PublicClient, d)).resolves.toBeUndefined();
    client.getStorageAt.mockResolvedValue(`0x${"0".repeat(24)}${addr("9").slice(2)}`);
    await expect(verify_definition(client as unknown as PublicClient, d)).rejects.toThrow("integration-implementation-changed");
  });
});
