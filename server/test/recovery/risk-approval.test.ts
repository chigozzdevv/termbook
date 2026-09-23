import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData } from "viem";
import { recoveryFundingTypedData } from "../../src/recovery/recovery.plan.js";

const mocks = vi.hoisted(() => ({
  source: { getChainId: vi.fn(), getBlock: vi.fn(), readContract: vi.fn() },
  plan: vi.fn(), verifyRoute: vi.fn(), registered: vi.fn(),
  config: vi.fn(), settlement: vi.fn(), approve: vi.fn(),
}));

vi.mock("viem", async (load) => ({
  ...await load<typeof import("viem")>(), createPublicClient: () => mocks.source,
}));
vi.mock("../../src/recovery/recovery.plan.js", async (load) => ({
  ...await load<typeof import("../../src/recovery/recovery.plan.js")>(),
  recoveryFundingPlan: mocks.plan, verifyRoute: mocks.verifyRoute,
}));
vi.mock("../../src/recovery/recovery.worker.js", () => ({ verifyRegisteredRecoveryOperation: mocks.registered }));
vi.mock("../../src/recovery/recovery.config.js", () => ({ recoveryConfig: mocks.config }));
vi.mock("../../src/settlement/settlement.repo.js", () => ({ settlementRepo: { get: mocks.settlement } }));
vi.mock("../../src/recovery/recovery.repo.js", () => ({ recoveryRepo: { approveRisk: mocks.approve } }));

const creditId = `0x${"1".repeat(64)}` as const;
const operationId = `0x${"2".repeat(64)}` as const;
const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;

afterEach(() => vi.resetAllMocks());

describe("recovery risk approval", () => {
  it("accepts an externally signed quote after Monad has cleared the pending seizure", async () => {
    const signer = privateKeyToAccount(`0x${"3".repeat(64)}`);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const operation = {
      operationId, creditId, sourceChain: 1, sourceAsset: address("4"),
      sourceRefundRecipient: address("5"), providerStatus: "PENDING_DEPOSIT",
    };
    const funding = {
      creditId, operationId, inbox: address("6"), depositAddress: address("7"),
      amount: 100n, quoteHash: `0x${"8".repeat(64)}` as const,
      nonce: 1n, deadline: BigInt(deadline),
    };
    mocks.settlement.mockResolvedValue(operation);
    mocks.plan.mockReturnValue({ operation, record: { deadline }, funding, digest: `0x${"9".repeat(64)}` });
    mocks.config.mockReturnValue({ sourceRpcs: { 1: "http://127.0.0.1:8545" }, riskSigner: signer.address });
    mocks.source.getChainId.mockResolvedValue(1);
    mocks.source.getBlock.mockResolvedValue({ number: 12n });
    mocks.source.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "riskSigner" ? signer.address : 100n);
    mocks.approve.mockImplementation(async (doc: Record<string, unknown>) => ({ ...doc, state: "approved" }));

    const { recoveryService } = await import("../../src/recovery/recovery.service.js");
    const approvalPlan = await recoveryService.riskApprovalPlan({ creditId, operationId });
    expect(hashTypedData(approvalPlan.typedData as never)).toBe(approvalPlan.fundingDigest);
    const signature = await signer.signTypedData(recoveryFundingTypedData(operation as never, funding));
    const result = await recoveryService.approveRisk({ creditId, operationId, signature }, signer.address);
    expect(result.state).toBe("approved");
    expect(mocks.approve).toHaveBeenCalledOnce();
  });
});
