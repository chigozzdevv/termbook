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
