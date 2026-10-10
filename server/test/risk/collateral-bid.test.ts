import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi, type PublicClient } from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
import { privateKeyToAccount } from "viem/accounts";
import { collateralBidSize, submitCollateralBid } from "../../src/risk/collateral-bid.js";
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 10143, core: `0x${"11".repeat(20)}`, rpcUrl: "http://monad" } }));
const collateral = `0x${"22".repeat(20)}` as const, settlement = `0x${"33".repeat(20)}` as const;
const word = `0x${"44".repeat(32)}` as const;
const account = privateKeyToAccount(word);
const limits = [{ chain_id: 10143, collateral_asset: collateral, settlement_asset: settlement, maximum_settlement: "100" }];
const readContract = vi.fn(), call = vi.fn(), submit = vi.fn();
const client = { readContract, call } as unknown as PublicClient;
const input = () => ({ client, account, creditId: word, revision: 1n, debt: 1000n,
  collateralAsset: collateral, collateralAmount: 10n ** 18n, settlementAsset: settlement, blockNumber: 10n, submit });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("LOCAL_COLLATERAL_BIDS", JSON.stringify(limits));
  submit.mockResolvedValue("success");
  readContract.mockImplementation(async ({ functionName }) => ({ localSaleMarketId: word,
    localSalePolicies: [collateral, word, 9500, 18, 6, 10n ** 18n, word, word, word, true],
    read: [25_000_000_000_000_000n, 1000n, 1n], balanceOf: 500n, allowance: 0n })[functionName as "read"]);
});
afterEach(() => vi.unstubAllEnvs());
describe("bounded collateral bidding", () => {
  it("bounds both legs by debt, wallet funds, operator budget and available collateral", () => {
    const base = { debt: 1000n, balance: 500n, maximum: 100n, collateral: 10n ** 18n, saleCap: 10n ** 18n, price: 25_000_000_000_000_000n, collateralDecimals: 18, settlementDecimals: 6 };
    expect(collateralBidSize(base)).toEqual({ collateralAmount: 4_000_000_000_000_000n, settlementAmount: 100n });
    expect(collateralBidSize({ ...base, debt: 50n })?.settlementAmount).toBe(50n);
    expect(collateralBidSize({ ...base, saleCap: 2_000_000_000_000_000n })?.settlementAmount).toBe(50n);
    expect(collateralBidSize({ ...base, collateral: 0n })).toBeNull();
    expect(collateralBidSize({ ...base, collateralDecimals: 6, price: 333_333_333_333_333_333n }))
      .toEqual({ collateralAmount: 300n, settlementAmount: 100n });
    expect(() => collateralBidSize({ ...base, price: 0n })).toThrow("risk-collateral-bid-price-invalid");
  });
  it("approves an exact bounded payment then submits the independent collateral bid", async () => {
    expect(await submitCollateralBid(input())).toBe(true);
    expect(submit).toHaveBeenCalledTimes(2);
    const tokenAbi = parseAbi(["function approve(address,uint256) returns(bool)"]);
    expect(decodeFunctionData({ abi: tokenAbi, data: submit.mock.calls[0]![0].data }).args?.[1]).toBe(100n);
    expect(decodeFunctionData({ abi: termbookCoreAbi, data: submit.mock.calls[1]![0].data }).functionName).toBe("recoverLocalCollateralWithBid");
    expect(submit.mock.calls.every(([tx]) => tx.account.address === account.address)).toBe(true);
  });
  it("waits for pending approval and leaves unconfigured markets untouched", async () => {
    submit.mockResolvedValue("pending"); expect(await submitCollateralBid(input())).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    vi.stubEnv("LOCAL_COLLATERAL_BIDS", undefined); expect(await submitCollateralBid(input())).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("rejects an inactive policy and wrong-chain or duplicate operator limits", async () => {
    readContract.mockResolvedValueOnce(word).mockResolvedValueOnce([collateral, word, 9500, 18, 6, 100n, word, word, word, false]);
    await expect(submitCollateralBid(input())).rejects.toThrow("risk-collateral-bid-policy-invalid");
    vi.stubEnv("LOCAL_COLLATERAL_BIDS", JSON.stringify([{ ...limits[0], chain_id: 143 }]));
    await expect(submitCollateralBid(input())).rejects.toThrow("risk-collateral-bid-config-invalid");
    vi.stubEnv("LOCAL_COLLATERAL_BIDS", JSON.stringify([...limits, ...limits]));
    await expect(submitCollateralBid(input())).rejects.toThrow("risk-collateral-bid-config-invalid");
    expect(submit).not.toHaveBeenCalled();
  });
});
