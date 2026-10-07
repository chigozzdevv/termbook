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
const action = capabilityDefinitionSchema.parse({ capability: "sell", label: "Sell MON", target: address("2"),
  signature: "function swap(uint256 amount,uint256 minimum,address account,bytes32 market)", settlement: "atomic",
  arguments: [{ source: "input", path: "amount" }, { source: "price_bound" }, { source: "credit_account" }, { source: "input", path: "market" }],
  spendPath: "amount", spendToken: address("3"), marketPath: "market", price: { kind: "min_output", amountPath: "amount", slippagePath: "slippage_bps", markets: [market] } });
const mapping = { applicationId: "1f3474c2-f4c2-461d-919d-143749012e27", category: "spot", versionId: bundle, codeHash: bundle,
  settlementAsset: address("4"), actions: [action], verifiedSources: [{ target: address("2"), sourceHash: market }] };
let amountWord = 0;
let maxInput = false;
beforeEach(() => {
  amountWord = 0; maxInput = false;
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (functionName === "priceProtection") return address("5");
    if (functionName === "ruleHashes") return bundle;
    if (functionName === "rule") return { oracle: address("6"), feedId: market, target: address("2"), selector: toFunctionSelector(action.signature),
      callIndex: 0, priceWord: 1, directionWord: 65535, maxAuthorizationAge: 60, maxSlippageBps: 100, maxDeviationBps: 500 };
    if (functionName === "read") return [10n ** 18n, 1000n, 1n];
    if (functionName === "amountRules") return maxInput ? [amountWord, 6, 18, true, true, true, address("4"), address("3")] : [amountWord, 18, 6, false, false, true, address("3"), address("4")];
    if (functionName === "deriveAmountBound") return 100_500_000n;
    throw new Error(functionName);
  });
});
describe("shared spot admission", () => {
  it("estimates exact-output intent funding through the approved onchain conversion", async () => {
    maxInput = true;
    const exact = { ...action, spendPath: undefined, spendToken: address("4"), fundingFromBound: true,
      price: { ...action.price!, kind: "max_input" as const } };
    const input = { capability: "sell", params: { amount: "100000000000000000000", slippage_bps: "50", market } };
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
    expect(integrationMappingSchema.safeParse({ ...mapping, actions: [{ ...action, fundingPath: "amount" }] }).success).toBe(false);
    expect(integrationMappingSchema.safeParse({ ...mapping, category: "vault", actions: [{ ...action, valuePath: "amount" }] }).success).toBe(false);
  });
});
