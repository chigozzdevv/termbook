import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, stringToHex, toFunctionSelector } from "viem";
import { capabilityDefinitionSchema } from "@termbook/schema";
import { actionFundingBound, admittedPrices } from "../../src/integration/integration.price.js";
import { integrationMappingSchema } from "../../src/integration/integration.schema.js";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => ({ readContract: mocks.read, getBlock: async () => ({ number: 100n }) }) }));
vi.mock("../../src/config/env.js", () => ({ env: { core: `0x${"1".repeat(40)}` } }));
const address = (n: string) => `0x${n.repeat(40)}` as `0x${string}`;
const bundle = keccak256(stringToHex("bundle")), market = keccak256(stringToHex("MON/USDC"));
const action = capabilityDefinitionSchema.parse({ capability: "place_order", label: "Sell MON", target: address("2"),
  signature: "function swap(uint256 amount,uint256 minimum,address account,bytes32 market)", settlement: "atomic",
  arguments: [{ source: "input", path: "amount.spend" }, { source: "price_bound" }, { source: "credit_account" }, { source: "input", path: "market_id" }],
  when: { direction: "sell", order_type: "market", sizing: "spend" },
  spendPath: "amount.spend", spendToken: address("3"), marketPath: "market_id", price: { kind: "min_output", amountPath: "amount.spend", slippagePath: "slippage_bps", markets: [market] } });
const mapping = { applicationId: "1f3474c2-f4c2-461d-919d-143749012e27", category: "spot", versionId: bundle, codeHash: bundle,
  settlementAsset: address("4"), actions: [action], verifiedSources: [{ target: address("2"), sourceHash: market }] };
let amountWord = 0;
let maxInput = false;
let binding: Record<string, unknown> = {};
beforeEach(() => {
  amountWord = 0; maxInput = false; binding = {};
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (functionName === "priceProtection") return address("5");
    if (functionName === "ruleHashes") return bundle;
    if (functionName === "rule") return { oracle: address("6"), feedId: market, target: address("2"), selector: toFunctionSelector(action.signature),
      callIndex: 0, priceWord: 1, directionWord: 65535, maxAuthorizationAge: 60, maxSlippageBps: 100, maxDeviationBps: 500, ...binding };
    if (functionName === "read") return [10n ** 18n, 1000n, 1n];
    if (functionName === "amountRules") return maxInput ? [amountWord, 6, 18, true, true, true, address("4"), address("3")] : [amountWord, 18, 6, false, false, true, address("3"), address("4")];
    if (functionName === "deriveAmountBound") return 100_500_000n;
    throw new Error(functionName);
  });
});
describe("shared spot admission", () => {
  it("checks the configured bound and fixed direction in a multi-call limit route", async () => {
    const signature = "function track(bytes32 route,uint256 price)";
    const limit = { ...action, when: { direction: "buy" as const, order_type: "limit" as const, sizing: "spend" as const },
      settlement: "asynchronous" as const, steps: [{ target: address("2"), signature,
        arguments: [{ source: "constant" as const, value: bundle }, { source: "price_bound" as const }] }],
      price: { kind: "price" as const, directionPath: "direction", markets: [market], maximumDirections: ["buy"], minimumDirections: ["sell"] } };
    binding = { selector: toFunctionSelector(signature), callIndex: 0, directionWord: 0,
      maximumDirection: BigInt(bundle), minimumDirection: BigInt(market) };
    expect(await admittedPrices(bundle, [limit], 100n, "spot", address("4"))).toBe(true);
    binding.maximumDirection = BigInt(market);
    expect(await admittedPrices(bundle, [limit], 100n, "spot", address("4"))).toBe(false);
    binding.maximumDirection = BigInt(bundle); binding.priceWord = 0;
    expect(await admittedPrices(bundle, [limit], 100n, "spot", address("4"))).toBe(false);
  });
  it("allows one authenticated bound to protect multiple calls and rejects missing bounds", () => {
    const multi = { ...action, steps: [{ target: address("2"), signature: "function checkMinimum(uint256 minimum)",
      arguments: [{ source: "price_bound" }] }] };
    expect(integrationMappingSchema.safeParse({ ...mapping, actions: [multi] }).success).toBe(true);
    const removeBound = (arg: typeof action.arguments[number]) => arg.source === "price_bound"
      ? { source: "constant", value: "0" } : arg;
    const unprotected = { ...multi, arguments: multi.arguments.map(removeBound),
      steps: [{ ...multi.steps[0], arguments: [{ source: "constant", value: "0" }] }] };
    expect(integrationMappingSchema.safeParse({ ...mapping, actions: [unprotected] }).success).toBe(false);
    expect(integrationMappingSchema.safeParse({ ...mapping, actions: [{ ...multi, price: undefined }] }).success).toBe(false);
  });
  it("estimates exact-output intent funding through the approved onchain conversion", async () => {
    maxInput = true;
    const exact = { ...action, spendPath: undefined, spendToken: address("4"), fundingFromBound: true,
      arguments: [{ source: "input" as const, path: "amount.receive" }, ...action.arguments.slice(1)],
      when: { direction: "buy" as const, order_type: "market" as const, sizing: "receive" as const },
      price: { ...action.price!, kind: "max_input" as const, amountPath: "amount.receive" } };
    const input = { use_case: "spot" as const, capability: "place_order", params: { market_id: market, direction: "buy", order_type: "market",
      amount: { receive: "100000000000000000000" }, slippage_bps: "50" } };
    expect(await actionFundingBound(bundle, exact, input)).toBe(100_500_000n);
    expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ functionName: "deriveAmountBound", blockNumber: 100n,
      args: [10n ** 18n, 100n * 10n ** 18n, 50, 6, 18, true, true] }));
    await expect(actionFundingBound(bundle, exact, { ...input, params: { ...input.params, slippage_bps: "101" } })).rejects.toThrow("action-slippage-denied");
  });
  it("admits amount protection only when the onchain word and input token match", async () => {
    expect(await admittedPrices(bundle, [action], 100n, "spot", address("4"))).toBe(true);
    amountWord = 1;
    expect(await admittedPrices(bundle, [action], 100n, "spot", address("4"))).toBe(false);
    amountWord = 0;
    expect(await admittedPrices(bundle, [{ ...action, spendToken: address("7") }], 100n, "spot", address("4"))).toBe(false);
  });
  it("rejects missing spot bounds, House funding of another token, and nonpayable native calls", () => {
    expect(integrationMappingSchema.safeParse(mapping).success).toBe(true);
    expect(integrationMappingSchema.safeParse({ ...mapping, actions: [{ ...action, price: undefined }] }).success).toBe(false);
    expect(integrationMappingSchema.safeParse({ ...mapping, actions: [{ ...action, fundingPath: "amount.spend" }] }).success).toBe(false);
    expect(integrationMappingSchema.safeParse({ ...mapping, category: "vault", actions: [{ ...action, valuePath: "amount" }] }).success).toBe(false);
  });
});
