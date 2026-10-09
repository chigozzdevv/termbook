import { describe, expect, it, vi } from "vitest";
import { type PublicClient } from "viem";
import { assess_state } from "../src/integration/assess.js";
import { use_case_configuration } from "../src/integration/use-case.js";
import { standardDefinition } from "./use-case.fixture.js";
import { addr, word } from "./plugin.fixture.js";

function fixture() {
  const d = standardDefinition(), c = use_case_configuration(d);
  const holdings = [addr("5"), addr("6")].map((asset) => ({ holding_id: asset, asset, amount: 10n, held_at: addr("2"), controlled_by: addr("2"), withdrawable_now: 10n }));
  const state = { block: { number: 1n, hash: word("a") }, holdings, orders: [], liabilities: [] };
  const chain = { getBlock: vi.fn(async () => state.block),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
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
});
