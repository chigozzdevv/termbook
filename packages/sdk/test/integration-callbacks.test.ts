import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, parseAbi, type PublicClient } from "viem";
import { validate_callbacks, type ActionProbe } from "../src/integration/callbacks.js";
import { package_integration } from "../src/integration/plugin.js";
import { executionCoreAbi, buildExecution, emptyExecutionPrice } from "../src/app/execution.js";
import { testPlugin, addr, word } from "./plugin.fixture.js";

function fixture() {
  const plugin = testPlugin(), identity = package_integration(plugin);
  const action = { use_case: "spot" as const, capability: "place_order" as const, params: { market_id: "TOKEN-USDC",
    direction: "buy" as const, order_type: "market" as const, amount: { spend: 100n }, slippage_bps: 50 } };
  const account = addr("2"), core = addr("1"), id = word("8"), tx_hash = word("d");
  const execution = buildExecution(plugin.definition.actions[0]!, action,
    { borrower: addr("b"), account, creditId: id, use_case: "spot", priceBound: 5n }, addr("6"));
  plugin.actions.place_order.build = async () => ({ calls: [{ target: addr("3"), value: 0n, spend_asset: addr("6"), spend_amount: 100n,
    data: encodeFunctionData({ abi: parseAbi(["function buy(uint256,uint256,address)"]), functionName: "buy", args: [100n, 5n, account] }) }],
    spending: [{ asset: addr("6"), maximum: 100n }], receiving: [{ asset: addr("5"), minimum: 5n, controlled_by: account }], completion: { kind: "atomic" } });
  const data = encodeFunctionData({ abi: executionCoreAbi, functionName: "executePlan", args: [id, execution,
    { drawAmount: 100n, maxDraw: 100n, nonce: 1n, deadline: 100n, revision: 1n, signer: addr("b"), signature: "0x", price: emptyExecutionPrice }] });
  const chain = { getBlock: vi.fn(async () => ({ number: 1n, hash: word("a"), transactions: [tx_hash] })),
    getTransaction: vi.fn(async () => ({ to: core, input: data })),
    getTransactionReceipt: vi.fn(async () => ({ blockNumber: 1n, blockHash: word("a"), transactionIndex: 0, status: "success" })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") return 0n;
      if (functionName === "core") return core;
      if (functionName === "meta") return { positions: 0n, pending: 0n, requests: 0n, reserved: 0n };
      if (functionName === "readAppValue") return [0n, 9000, 0n, 1n];
      return { bundleId: identity.version_id, borrower: addr("b"), account };
    }) };
  const probe: ActionProbe = { action, credit_id: id, tx_hash, minimum_receive: 5n };
  const input = { core, active_credit_id: id, recovered_credit_id: word("9"), probes: [probe] };
  return { plugin, chain, input };
}
describe("integration callback lifecycle checks", () => {
  it("binds a builder to the actual finalized Core transaction", async () => {
    const { plugin, chain, input } = fixture();
    await expect(validate_callbacks(chain as unknown as PublicClient, plugin, input)).resolves.toBeUndefined();
    expect(chain.getTransaction).toHaveBeenCalledWith({ hash: input.probes[0]!.tx_hash });
  });
  it("rejects an untested route and transactions sent somewhere else", async () => {
    const { plugin, chain, input } = fixture();
    await expect(validate_callbacks(chain as unknown as PublicClient, plugin, { ...input, probes: [] })).rejects.toThrow("integration-probes-incomplete");
    chain.getTransaction.mockResolvedValue({ to: addr("f"), input: "0x" });
    await expect(validate_callbacks(chain as unknown as PublicClient, plugin, input)).rejects.toThrow("integration-probe-transaction-invalid");
  });
  it("rejects a declared exit that cannot complete after recovery", async () => {
    const { plugin, chain, input } = fixture();
    plugin.exit.next = async () => ({ status: "blocked", reason: "funds-stuck" });
    await expect(validate_callbacks(chain as unknown as PublicClient, plugin, input)).rejects.toThrow("integration-recovered-exit-incomplete");
  });
});
