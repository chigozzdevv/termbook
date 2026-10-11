import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, parseAbi, toFunctionSelector, type PublicClient } from "viem";
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
    getTransaction: vi.fn(async (_input?: { hash: string }) => ({ to: core, input: data })),
    getTransactionReceipt: vi.fn(async (_input?: { hash: string }) => ({ blockNumber: 1n, blockHash: word("a"), transactionIndex: 0, status: "success" })),
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
  it("passes a limit-price bound independently of a minimum output", async () => {
    const f = fixture(), route = f.plugin.definition.actions[0]!;
    route.when!.order_type = "limit"; route.settlement = "asynchronous"; route.expiry = "none";
    route.price = { kind: "price", directionPath: "direction", maximumDirections: ["buy"], minimumDirections: ["sell"], markets: route.price!.markets };
    route.orderSizing = { baseAsset: addr("5"), quoteAsset: addr("6"), baseDecimals: 18, quoteDecimals: 6, feeBps: 0, lotSize: "1" };
    route.arguments[0] = { source: "input", path: "_derived.order_quantity" };
    route.spendPath = "_derived.order_spend"; route.fundingPath = "_derived.order_spend";
    const action = { use_case: "spot" as const, capability: "place_order" as const, params: { market_id: "TOKEN-USDC",
      direction: "buy" as const, order_type: "limit" as const, amount: { spend: 100n }, limit_price: 2n * 10n ** 18n } };
    f.input.probes = [{ ...f.input.probes[0]!, action, minimum_receive: undefined, price_bound: 5n }];
    const execution = buildExecution(route, action, { borrower: addr("b"), account: addr("2"), creditId: word("8"), use_case: "spot", priceBound: 5n }, addr("6"));
    const builder = vi.fn(async () => ({ calls: execution.calls.map((call) => ({ target: call.target, value: call.nativeValue,
      spend_asset: call.spendToken, spend_amount: call.spendAmount, data: call.data })),
      spending: [{ asset: addr("6"), maximum: 100n }], receiving: [], completion: { kind: "pending" as const,
        deadline: 2_000_000_000, tracking: { target: addr("3"), event: "Order(uint256)" } } }));
    f.plugin.actions.place_order.build = builder;
    f.chain.getTransaction.mockResolvedValue({ to: addr("1"), input: encodeFunctionData({ abi: executionCoreAbi, functionName: "executePlan", args: [word("8"), execution,
      { drawAmount: 100n, maxDraw: 100n, nonce: 1n, deadline: 100n, revision: 1n, signer: addr("b"), signature: "0x", price: emptyExecutionPrice }] }) });
    const identity = package_integration(f.plugin), read = f.chain.readContract.getMockImplementation()!;
    f.chain.readContract.mockImplementation(async (call) => call.functionName === "creditDetails"
      ? { bundleId: identity.version_id, borrower: addr("b"), account: addr("2") } : read(call));
    await expect(validate_callbacks(f.chain as unknown as PublicClient, f.plugin, f.input)).resolves.toBeUndefined();
    expect(builder).toHaveBeenCalledWith(expect.objectContaining({ price_bound: 5n, minimum_receive: undefined }));
  });
  it("resolves the single market for cancellation without a market input", async () => {
    const f = fixture();
    const route = { capability: "cancel_order", executionKey: "cancel", label: "Cancel", settlement: "atomic" as const,
      target: addr("3"), signature: "function cancel(uint256)", arguments: [{ source: "input" as const, path: "order_id" }] };
    f.plugin.definition.actions.push(route);
    const assessment = f.plugin.definition.assessment!;
    assessment.action_limits.push({ action: "cancel", maximum_input: "0", maximum_exposure: "0" });
    assessment.calls.push({ target: addr("3"), selector: toFunctionSelector("cancel(uint256)"), recovery: false, native_maximum: "0",
      words: [{ kind: "range", exact: word("0"), minimum: "1", maximum: "100" }] });
    const action = { use_case: "spot" as const, capability: "cancel_order" as const, params: { order_id: "7" } };
    const execution = buildExecution(route, action, { borrower: addr("b"), account: addr("2"),
      creditId: word("8"), use_case: "spot" }, addr("6"));
    const builder = vi.fn(async () => ({ calls: execution.calls.map((call) => ({ target: call.target, value: call.nativeValue,
      spend_asset: call.spendToken, spend_amount: call.spendAmount, data: call.data })), spending: [], receiving: [], completion: { kind: "atomic" as const } }));
    f.plugin.actions.cancel_order = { build: builder }; f.input.probes.push({ action, credit_id: word("8"), tx_hash: word("e") });
    const original = await f.chain.getTransaction();
    const cancelled = { to: addr("1"), input: encodeFunctionData({ abi: executionCoreAbi, functionName: "executePlan", args: [word("8"), execution,
      { drawAmount: 0n, maxDraw: 0n, nonce: 2n, deadline: 100n, revision: 1n, signer: addr("b"), signature: "0x", price: emptyExecutionPrice }] }) };
    f.chain.getTransaction.mockImplementation(async (call) => call?.hash === word("e") ? cancelled : original);
    f.chain.getTransactionReceipt.mockImplementation(async (call) => ({ blockNumber: 1n, blockHash: word("a"),
      transactionIndex: call?.hash === word("e") ? 1 : 0, status: "success" }));
    f.chain.getBlock.mockResolvedValue({ number: 1n, hash: word("a"), transactions: [word("d"), word("e")] });
    const identity = package_integration(f.plugin), read = f.chain.readContract.getMockImplementation()!;
    f.chain.readContract.mockImplementation(async (call) => call.functionName === "creditDetails"
      ? { bundleId: identity.version_id, borrower: addr("b"), account: addr("2") } : read(call));
    await expect(validate_callbacks(f.chain as unknown as PublicClient, f.plugin, f.input)).resolves.toBeUndefined();
    expect(builder).toHaveBeenCalledWith(expect.objectContaining({ market: f.plugin.markets[0] }));
  });
});
