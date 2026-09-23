import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { RecoveryModel } from "../../src/recovery/recovery.model.js";

const mocks = vi.hoisted(() => ({
  source: { getBlock: vi.fn(), readContract: vi.fn(), getTransactionReceipt: vi.fn() },
  settlement: vi.fn(), config: vi.fn(), evidence: vi.fn(),
  get: vi.fn(), open: vi.fn(), renew: vi.fn(), approve: vi.fn(),
}));
vi.mock("viem", async (load) => ({
  ...await load<typeof import("viem")>(), createPublicClient: () => mocks.source,
}));
vi.mock("../../src/recovery/recovery.config.js", () => ({ recoveryConfig: mocks.config }));
vi.mock("../../src/settlement/settlement.repo.js", () => ({ settlementRepo: { get: mocks.settlement } }));
vi.mock("../../src/recovery/refund.plan.js", async (load) => ({
  ...await load<typeof import("../../src/recovery/refund.plan.js")>(), verifyFinalizedRefund: mocks.evidence,
}));
vi.mock("../../src/recovery/refund.repo.js", () => ({ refundRepo: {
  get: mocks.get, open: mocks.open, renew: mocks.renew, approve: mocks.approve,
} }));

const id = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const operationId = id("1");
const creditId = id("2");
const refundTxHash = id("3");
const vault = address("4");
const asset = address("5");
const route = privateKeyToAccount(id("6"));
const risk = privateKeyToAccount(id("7"));
const input = { operationId, creditId, refundTxHash };

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

function prepare(sourceTime: bigint) {
  mocks.config.mockReturnValue({
    sourceRpcs: { 1: "http://source" }, riskSigner: risk.address,
    routeSigner: { address: route.address },
  });
  mocks.settlement.mockResolvedValue({
    operationId, creditId, kind: "recovery", sourceChain: 1, sourceAsset: asset,
    sourceRefundRecipient: vault, providerStatus: "REFUNDED", providerStatusCheckedAt: Date.now(),
    providerRefundedAmount: "40", providerOriginTxHashes: [id("8")],
  });
  vi.spyOn(RecoveryModel, "findOne").mockReturnValue({ lean: async () => ({
    operationId, creditId, sourceChain: 1, recoveryVault: vault,
    depositAddress: address("9"), quoteHash: id("a"), state: "confirmed",
  }) } as never);
  mocks.evidence.mockResolvedValue({
    amount: 40n, sender: address("b"), timestamp: sourceTime,
    blockNumber: 10n, blockHash: id("c"),
  });
  mocks.source.getBlock.mockResolvedValue({ number: 12n, timestamp: BigInt(Math.floor(Date.now() / 1000)) });
  mocks.source.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
    functionName === "routeSigner" ? route.address : risk.address);
}

describe("source refund risk approval", () => {
  it("allows a finalized old transfer with a fresh approval deadline and exposes attribution evidence", async () => {
    prepare(100n);
    mocks.get.mockResolvedValue(null);
    mocks.open.mockImplementation(async (record) => record);
    const { refundService } = await import("../../src/recovery/refund.service.js");
    const plan = await refundService.riskApprovalPlan(input, risk.address);
    expect(plan.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000) + 6 * 86_400);
    expect(plan.sourceTransfer).toMatchObject({ txHash: refundTxHash, sender: address("b"), amount: "40" });
    expect(plan.providerEvidence).toMatchObject({ status: "REFUNDED", refundedAmount: "40", quoteHash: id("a") });
    expect(plan.providerEvidence.originTxHashes).toEqual([id("8")]);
  });

  it("renews an expired approval with a new nonce and requires a new risk signature", async () => {
    prepare(100n);
    const oldDeadline = Math.floor(Date.now() / 1000) - 1_000;
    mocks.source.getBlock.mockResolvedValue({ number: 12n, timestamp: BigInt(oldDeadline + 1) });
    const { refundDigest, refundTypedData } = await import("../../src/recovery/refund.plan.js");
    const previous = {
      operationId, creditId, refundTxHash, sourceChain: 1, recoveryVault: vault,
      asset, amount: "40", nonce: "1", deadline: oldDeadline,
      riskSigner: risk.address.toLowerCase(), refundDigest: "", state: "pending",
    };
    previous.refundDigest = refundDigest(previous);
    let current = previous;
    mocks.get.mockImplementation(async () => current);
    mocks.open.mockImplementation(async () => current);
    mocks.renew.mockImplementation(async (_prior, deadline: number) => {
      const renewed = { ...previous, nonce: "2", deadline };
      current = { ...renewed, refundDigest: refundDigest(renewed) };
      return current;
    });
    const { refundService } = await import("../../src/recovery/refund.service.js");
    const plan = await refundService.riskApprovalPlan(input, risk.address);
    expect(mocks.renew).toHaveBeenCalledOnce();
    expect(plan.typedData.message.nonce).toBe("2");
    const staleSignature = await risk.signTypedData(refundTypedData(previous));
    await expect(refundService.approveRisk({ ...input, signature: staleSignature }, risk.address))
      .rejects.toThrow("recovery-refund-signature-invalid");
    const freshSignature = await risk.signTypedData(refundTypedData(current));
    mocks.approve.mockResolvedValue(current);
    await expect(refundService.approveRisk({ ...input, signature: freshSignature }, risk.address))
      .resolves.toMatchObject({ state: "approved" });
    expect(mocks.approve).toHaveBeenCalledWith(refundTxHash, current.refundDigest, freshSignature);
  });
});
