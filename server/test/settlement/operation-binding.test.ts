import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256 } from "viem";
import { env } from "../../src/config/env.js";
import { settlementService } from "../../src/settlement/settlement.service.js";
import { settlementRepo } from "../../src/settlement/settlement.repo.js";
const rpc = vi.hoisted(() => ({ getChainId: vi.fn(async () => 143), getBlock: vi.fn(async () => ({ number: 10n })), readContract: vi.fn() }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => rpc }));
const a = (n: string) => `0x${n.repeat(40)}` as `0x${string}`;
const w = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;
const original = { auroraRoutes: env.auroraRoutes, auroraApiKey: env.auroraApiKey, settlementFactory: env.settlementFactory, monadChainId: env.monadChainId };
function input() {
  return { operationId: w("1"), kind: "repay" as const, payer: a("2"), nonce: "1", sourceChain: 1,
    sourceAsset: a("3"), vault: a("4"), token: a("5"), creditId: w("6"), maxAmountIn: "100", maxReceived: "120",
    minAmountOut: "90", deadline: Math.floor(Date.now() / 1000) + 600, sourceRefund: a("2"), sourceRefundRecipient: a("2"),
    refundRecipient: a("2"), monadRefundRecipient: a("2"), routeId: w("7"), routeVersion: w("0").slice(0, -1) + "1" };
}
beforeEach(() => {
  vi.clearAllMocks();
  env.monadChainId = 143; env.settlementFactory = a("8"); env.auroraApiKey = "fixture";
  const request = input();
  env.auroraRoutes = JSON.stringify([{ ...request, sourceAssetId: "eth:test", destinationAssetId: "monad:test", slippageBps: 50, maxAmountIn: "200" }]);
  rpc.readContract.mockImplementation(async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
    const values = { inboxOf: a("9"), routeRegistry: a("a"), vault: request.vault, token: request.token, creditId: request.creditId,
      minOut: 90n, maxReceived: 120n, refundRecipient: request.refundRecipient, deadline: BigInt(request.deadline),
      settlementInboxes: true, lpInboxRecipient: a("0"), lpInboxMinShares: 0n, operationDigestOf: w("b") };
    if (functionName === "operationDigest") {
      const operation = args[0] as Record<string, unknown>;
      return operation["maxAmountIn"] === 100n && operation["routeId"] === w("7") ? w("b") : w("c");
    }
    if (functionName === "routes") return [a("d"), keccak256(encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }], [1n, request.sourceAsset, 143n, request.token])), true, 200n, 1n];
    return values[functionName as keyof typeof values];
  });
});
afterEach(() => { Object.assign(env, original); vi.restoreAllMocks(); });
describe("settlement authorization binding", () => {
  it("rejects a quote request with a different funding cap even if its inbox fields match", async () => {
    const save = vi.spyOn(settlementRepo, "save");
    await expect(settlementService.register({ ...input(), maxAmountIn: "101" })).rejects.toMatchObject({ message: "settlement-operation-mismatch" });
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects substituting a route on an existing operation", async () => {
    const request = input(); request.routeId = w("f");
    env.auroraRoutes = JSON.stringify([{ ...request, sourceAssetId: "eth:test", destinationAssetId: "monad:test", slippageBps: 50 }]);
    await expect(settlementService.register(request)).rejects.toMatchObject({ message: "settlement-operation-mismatch" });
  });
  it("can reuse the matching registered quote after checking the full authorization", async () => {
    const quote = { operationId: input().operationId, quote: { bound: true } };
    vi.spyOn(settlementRepo, "save").mockResolvedValue(quote);
    expect(await settlementService.register(input())).toBe(quote);
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "operationDigestOf", blockNumber: 10n }));
  });
});
