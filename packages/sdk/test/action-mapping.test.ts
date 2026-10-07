import { describe, expect, it } from "vitest";
import { actionFunding, type CapabilityDefinition } from "@termbook/schema";
import { decodeFunctionData, parseAbiItem } from "viem";
import { buildAction } from "../src/app/action.js";
import { buildExecution } from "../src/app/execution.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const creditId = `0x${"a".repeat(64)}` as `0x${string}`;
const definition: CapabilityDefinition = {
  capability: "place_order", label: "Place order", target: address("1"),
  signature: "function placeOrder(uint256 market,uint8 direction,uint256 margin,address account)",
  arguments: [
    { source: "input", path: "market_id" },
    { source: "input", path: "direction", choices: { long: "1", short: "2" } },
    { source: "input", path: "amount.margin", min: "1", max: "1000000000" },
    { source: "credit_account" },
  ],
  fundingPath: "amount.margin", settlement: "asynchronous",
};
const context = { borrower: address("2"), account: address("3"), creditId };

describe("registered application action mapping", () => {
  it("spends owned tokens without requesting a USDC draw", () => {
    const sell: CapabilityDefinition = { capability: "sell", label: "Sell", target: address("1"), signature: "function sell(uint256 amount)",
      arguments: [{ source: "input", path: "amount", min: "1" }], spendPath: "amount", spendToken: address("6"), settlement: "atomic" };
    const plan = buildExecution(sell, { capability: "sell", params: { amount: "100" } }, context, address("5"));
    expect(plan.requiredInput).toBe(0n);
    expect(plan.calls[0]).toMatchObject({ spendToken: address("6"), spendAmount: 100n, nativeValue: 0n });
    expect(() => buildExecution({ ...sell, fundingPath: "amount" }, { capability: "sell", params: { amount: "100" } }, context, address("5"))).toThrow("action-funding-token-mismatch");
    expect(buildExecution({ ...sell, spendToken: address("5") }, { capability: "sell", params: { amount: "100" } }, context, address("5")).requiredInput).toBe(100n);
  });
  it("attaches native MON independently of USDC funding and token approvals", () => {
    const wrap: CapabilityDefinition = { capability: "wrap", label: "Wrap MON", target: address("1"), signature: "function deposit() payable",
      arguments: [], valuePath: "mon_amount", settlement: "atomic" };
    const plan = buildExecution(wrap, { capability: "wrap", params: { mon_amount: "1000000000000000000" } }, context, address("5"));
    expect(plan.requiredInput).toBe(0n);
    expect(plan.calls[0]).toMatchObject({ nativeValue: 10n ** 18n, spendAmount: 0n });
    expect(() => buildExecution(wrap, { capability: "wrap", params: { mon_amount: "-1" } }, context, address("5"))).toThrow("action-input-invalid");
  });
  it("funds exact-output swaps from the derived maximum input without a caller-supplied bound", () => {
    const swap: CapabilityDefinition = { capability: "swap", label: "Buy", target: address("1"), signature: "function swap(uint256 amountOut,uint256 maxInput,bytes32 market)",
      arguments: [{ source: "input", path: "output" }, { source: "price_bound" }, { source: "input", path: "market" }], fundingFromBound: true,
      marketPath: "market", settlement: "atomic", price: { kind: "max_input", amountPath: "output", slippagePath: "bps", markets: [creditId] } };
    const params = { output: "100", market: creditId, bps: "50" };
    const plan = buildExecution(swap, { capability: "swap", params }, { ...context, priceBound: 101n }, address("5"));
    expect(plan.requiredInput).toBe(101n); expect(plan.calls[0]!.spendAmount).toBe(101n);
    const native = buildExecution({ ...swap, fundingFromBound: false, valueFromBound: true, signature: "function swap(uint256 amountOut,uint256 maxInput,bytes32 market) payable" },
      { capability: "swap", params }, { ...context, priceBound: 101n }, address("5"));
    expect(native.requiredInput).toBe(0n); expect(native.calls[0]!.nativeValue).toBe(101n);
    expect(native.calls[0]!.spendAmount).toBe(0n);
  });
  it("includes separately funded execution fees in the required draw", () => {
    const sequence = { ...definition, steps: [{ target: address("4"),
      signature: "function payExecutionFee(uint256 fee,address account)", fundingPath: "execution_fee",
      arguments: [{ source: "input" as const, path: "execution_fee", min: "1", max: "10" }, { source: "credit_account" as const }],
    }] };
    const plan = buildExecution(sequence, { capability: "place_order", params: { market_id: "7", direction: "long",
      amount: { margin: "100" }, execution_fee: "5" } }, context, address("5"));
    expect(plan.requiredInput).toBe(105n);
    expect(plan.calls.map((call) => call.spendAmount)).toEqual([5n, 100n]);
  });
  it("maps a complete sequence and binds its market and exposure separately from funding", () => {
    const sequence = { ...definition, marketPath: "market_id", exposurePath: "amount.notional", steps: [{
      target: address("4"), signature: "function configure(uint256 notional,address account)",
      arguments: [{ source: "input" as const, path: "amount.notional", max: "1000" }, { source: "credit_account" as const }],
    }] };
    const action = { capability: "place_order", params: { market_id: "7", direction: "long",
      amount: { margin: "100", notional: "500" } } };
    const plan = buildExecution(sequence, action, context, address("5"));
    expect(plan.requiredInput).toBe(100n);
    expect(plan.exposureLimit).toBe(500n);
    expect(plan.market).toBe(`0x${"0".repeat(63)}7`);
    expect(plan.calls.map((call) => call.target)).toEqual([address("4"), address("1")]);
    expect(plan.calls.map((call) => call.spendAmount)).toEqual([0n, 100n]);
    expect(plan.calls[1]?.spendToken).toBe(address("5"));
    expect(() => buildExecution(sequence, { ...action, params: { ...action.params,
      amount: { margin: "100", notional: "1001" } } }, context, address("5"))).toThrow("action-input-invalid");
  });
  it("encodes only published arguments and derives draw funding", () => {
    const action = { capability: "place_order", params: { market_id: "7", direction: "long", amount: { margin: "700000000" } } };
    expect(actionFunding(definition, action)).toBe(700000000n);
    const call = buildAction(definition, action, context);
    expect(call.target).toBe(address("1"));
    expect(call.requiredInput).toBe(700000000n);
    expect(decodeFunctionData({ abi: [parseAbiItem(definition.signature)], data: call.data }).args)
      .toEqual([7n, 1, 700000000n, address("3")]);
  });

  it("rejects tampering, missing fields, and amounts outside the policy", () => {
    expect(() => buildAction(definition, { capability: "place_order", params: { market_id: "7", direction: "long", amount: { margin: "1" } }, target: address("4") } as never, context)).toThrow("capability-denied");
    expect(() => actionFunding(definition, { capability: "place_order", params: { market_id: "7", direction: "long", amount: { margin: "1000000001" } } })).toThrow("action-input-invalid");
    expect(() => buildAction(definition, { capability: "place_order", params: { market_id: "7", direction: "sideways", amount: { margin: "1" } } }, context)).toThrow("action-input-invalid");
    expect(() => buildAction(definition, { capability: "place_order", params: { market_id: "7", direction: "long", amount: {} } }, context)).toThrow("action-input-required");
    expect(() => buildAction(definition, { capability: "place_order", params: { market_id: "7", direction: "long", amount: { margin: "1", notional: "99" } } }, context)).toThrow("action-input-invalid");
  });
});
