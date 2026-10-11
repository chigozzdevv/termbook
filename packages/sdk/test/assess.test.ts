import { describe, expect, it, vi } from "vitest";
import { keccak256, stringToHex, type PublicClient } from "viem";
import { ReadProgramBuilder } from "../src/integration/read-program.js";
import { assess_state } from "../src/integration/assess.js";
import { use_case_configuration } from "../src/integration/use-case.js";
import { standardDefinition } from "./use-case.fixture.js";
import { addr, word } from "./plugin.fixture.js";

function fixture() {
  const d = standardDefinition(), c = use_case_configuration(d);
  const holdings = [addr("5"), addr("6")].map((asset) => ({ holding_id: asset, asset, amount: 10n, held_at: addr("2"), controlled_by: addr("2"), withdrawable_now: 10n }));
  const state = { block: { number: 1n, hash: word("a") }, holdings, orders: [], liabilities: [] };
  const chain = { getBlock: vi.fn(async () => state.block),
    readContract: vi.fn(async ({ functionName }: { functionName: string }): Promise<unknown> => {
      if (functionName === "balanceOf") return 10n;
      if (functionName === "core") return addr("1");
      if (functionName === "creditDetails") return { account: addr("2"), bundleId: c.version_id };
      if (functionName === "readAppValue") return [20n, 9000, 0n, 100n];
      if (functionName === "meta") return { positions: 0n, pending: 0n, requests: 0n, reserved: 3n };
      throw new Error("unexpected-call");
    }) };
  const context = { client: chain as unknown as PublicClient, credit_id: word("c"), account: addr("2"), block: state.block };
  return { d, chain, state, context };
}
describe("independent state assessment", () => {
  it("uses the shared reader's signed net value and binds all reads to one block", async () => {
    const f = fixture(); const result = await assess_state(f.d, f.state, f.context);
    expect(result).toMatchObject({ verified: true, net_value: 20n, retained_bps: 9000 });
    expect(f.chain.readContract.mock.calls.every(([call]) => (call as { blockNumber?: bigint }).blockNumber === 1n)).toBe(true);
  });
  it("rejects fabricated or omitted holdings and undeclared obligations", async () => {
    const f = fixture(); f.state.holdings[0]!.amount = 11n;
    await expect(assess_state(f.d, f.state, f.context)).rejects.toThrow("integration-holding-mismatch");
    f.state.holdings[0]!.amount = 10n; f.state.holdings.pop();
    await expect(assess_state(f.d, f.state, f.context)).rejects.toThrow("integration-holding-omitted");
    const g = fixture(); g.chain.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "meta") return { positions: 0n, pending: 1n, requests: 0n, reserved: 0n };
      if (functionName === "balanceOf") return 10n;
      if (functionName === "core") return addr("1");
      if (functionName === "creditDetails") return { account: addr("2"), bundleId: use_case_configuration(g.d).version_id };
      return [20n, 9000, 0n, 100n];
    });
    await expect(assess_state(g.d, g.state, g.context)).rejects.toThrow("integration-state-count-mismatch");
  });
  it("rejects reassigned Credit Accounts and a canonical block changing during assessment", async () => {
    const f = fixture(); f.chain.getBlock.mockResolvedValue({ number: 1n, hash: word("f") });
    await expect(assess_state(f.d, f.state, f.context)).rejects.toThrow("integration-state-block-mismatch");
    const g = fixture(); g.chain.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "balanceOf") return 10n;
      if (functionName === "core") return addr("1");
      return { account: addr("f"), bundleId: use_case_configuration(g.d).version_id };
    });
    await expect(assess_state(g.d, g.state, g.context)).rejects.toThrow("integration-assessment-credit-invalid");
  });
  function tracked() {
    const f = fixture(), a = f.d.assessment!;
    const program = (count: number) => {
      const p = new ReadProgramBuilder(), q = p.query(addr("7"), "0x12345678");
      return p.finish(Array.from({ length: count }, (_, i) => p.word(q, p.constant(BigInt(i)))));
    };
    f.d.pins.push({ target: addr("e"), code_hash: word("b") });
    f.d.verified_sources.push({ target: addr("e"), source_hash: word("a") });
    a.max_pending = 4;
    a.markets = [{ market_id: "TOKEN-USDC", receipt: addr("5"), asset0: a.assets[0]!, maximum_exposure: "1000" }];
    a.custody = [{ target: addr("7"), token: addr("6"), program: program(2), maximum: "1000", dust: "0" }];
    a.orders = { tracker: addr("e"), rules: [{ id: word("1"), market_id: "TOKEN-USDC", target: addr("7"), input: addr("6"),
      custody: addr("7"), counter: program(1), state: program(6), balance: program(2), maximum_input: "1000", maximum_quantity: "1000", buy: true }] };
    const state = { ...f.state, holdings: [...f.state.holdings, { holding_id: "venue-cash", asset: addr("6"), amount: 25n,
      held_at: addr("7"), controlled_by: addr("2"), withdrawable_now: 25n }], orders: [{ order_id: "7", market_id: "TOKEN-USDC", owner: addr("2"),
      direction: "buy" as const, input_asset: addr("6"), output_asset: addr("5"), remaining_input: 40n, filled_input: 60n,
      exposure: 0n, status: "partially_filled" as const }] };
    const fallback = f.chain.readContract.getMockImplementation()!;
    f.chain.readContract.mockImplementation(async (call) => {
      if (call.functionName === "creditDetails") return { account: addr("2"), bundleId: use_case_configuration(f.d).version_id };
      if (call.functionName === "custodyBalance") return 25n;
      if (call.functionName === "meta") return { positions: 0n, pending: 1n, requests: 0n, reserved: 0n };
      if (call.functionName === "order") return [word("7"), { remaining: 40n, filled: 60n, maxLiability: 0n, status: 1 }];
      if (call.functionName === "pendingDetails") return [keccak256(stringToHex("TOKEN-USDC")), addr("6"), 7n];
      if (call.functionName === "pendingExposure") return 0n;
      return fallback(call);
    });
    return { ...f, state };
  }
  it("independently verifies venue cash and maps tracked IDs to venue order IDs", async () => {
    const f = tracked();
    await expect(assess_state(f.d, f.state, f.context)).resolves.toMatchObject({ verified: true });
    f.state.orders[0]!.order_id = "8";
    await expect(assess_state(f.d, f.state, f.context)).rejects.toThrow("integration-order-mismatch");
  });
  it("rejects omitted venue custody, duplicated balances and fabricated order proceeds", async () => {
    const f = tracked(); f.state.holdings.pop();
    await expect(assess_state(f.d, f.state, f.context)).rejects.toThrow("integration-holding-mismatch");
    const g = tracked(); g.state.holdings.push({ ...g.state.holdings.at(-1)!, holding_id: "duplicate-venue" });
    await expect(assess_state(g.d, g.state, g.context)).rejects.toThrow("integration-custody-invalid");
    const h = tracked();
    await expect(assess_state(h.d, { ...h.state, orders: [{ ...h.state.orders[0]!, filled_output: 999n }] }, h.context)).rejects.toThrow("integration-order-mismatch");
    const wrongAsset = tracked(); wrongAsset.state.orders[0]!.output_asset = addr("6");
    await expect(assess_state(wrongAsset.d, wrongAsset.state, wrongAsset.context)).rejects.toThrow("integration-order-mismatch");
  });
});
