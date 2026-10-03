import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const mocks = vi.hoisted(() => ({
  source: {
    getChainId: vi.fn(), getTransactionReceipt: vi.fn(), getBlock: vi.fn(), readContract: vi.fn(),
    simulateContract: vi.fn(), getTransactionCount: vi.fn(), sendRawTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  },
  wallet: vi.fn(), evidence: vi.fn(),
  config: vi.fn(), listPending: vi.fn(), claim: vi.fn(), prepare: vi.fn(), state: vi.fn(), release: vi.fn(),
  acquireFunder: vi.fn(), releaseFunder: vi.fn(),
}));
vi.mock("../../src/chain/keeper-funding.js", () => ({ assertKeeperFunding: vi.fn(), assertSignedKeeperFunding: vi.fn() }));
vi.mock("viem", async (load) => ({
  ...await load<typeof import("viem")>(), createPublicClient: () => mocks.source,
  createWalletClient: mocks.wallet,
}));
vi.mock("../../src/recovery/refund.plan.js", async (load) => ({
  ...await load<typeof import("../../src/recovery/refund.plan.js")>(), verifyFinalizedRefund: mocks.evidence,
}));
vi.mock("../../src/recovery/recovery.config.js", () => ({ recoveryConfig: mocks.config }));
vi.mock("../../src/recovery/refund.repo.js", () => ({ refundRepo: {
  listPending: mocks.listPending, claim: mocks.claim, prepare: mocks.prepare,
  state: mocks.state, release: mocks.release,
} }));
vi.mock("../../src/recovery/recovery.repo.js", () => ({ recoveryRepo: {
  acquireFunder: mocks.acquireFunder, releaseFunder: mocks.releaseFunder,
} }));

const id = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;

afterEach(() => vi.resetAllMocks());

describe("source refund worker", () => {
  it("confirms a finalized submitted record even after the signature deadline", async () => {
    const risk = privateKeyToAccount(id("1"));
    const rawTx = "0x1234";
    const txHash = keccak256(rawTx);
    const record = {
      operationId: id("2"), creditId: id("3"), refundTxHash: id("4"), sourceChain: 1,
      recoveryVault: address("5"), asset: address("6"), amount: "40", nonce: "1",
      deadline: Math.floor(Date.now() / 1000) - 100, refundDigest: "", riskSigner: risk.address,
      txHash, rawTx, sourceNonce: 5, state: "mined",
    };
    const { refundDigest, refundTypedData } = await import("../../src/recovery/refund.plan.js");
    record.refundDigest = refundDigest(record);
    const riskSignature = await risk.signTypedData(refundTypedData(record));
    mocks.config.mockReturnValue({
      sourceRpcs: { 1: "http://source" }, riskSigner: risk.address,
      funder: { address: address("7") },
    });
    mocks.listPending.mockResolvedValue([{ refundTxHash: record.refundTxHash }]);
    mocks.claim.mockResolvedValue({ token: "lease", record: { ...record, riskSignature } });
    mocks.acquireFunder.mockResolvedValue(true);
    mocks.source.getChainId.mockResolvedValue(1);
    mocks.source.getTransactionReceipt.mockResolvedValue({
      status: "success", blockNumber: 10n, blockHash: id("8"), transactionIndex: 0,
      transactionHash: txHash, logs: [{
        address: record.recoveryVault,
        topics: [keccak256(stringToHex("SourceRefundRecorded(bytes32,bytes32,uint256)")), record.creditId, record.operationId],
        data: encodeAbiParameters([{ type: "uint256" }], [40n]),
      }],
    });
    mocks.source.getBlock.mockImplementation(async ({ blockTag }: { blockTag?: string }) =>
      blockTag === "finalized" ? { number: 12n } : {
        hash: id("8"), transactions: [txHash],
      });
    mocks.source.readContract.mockResolvedValue(true);
    const { runRecoveryRefundWorker } = await import("../../src/recovery/refund.worker.js");
    expect(await runRecoveryRefundWorker()).toBe(1);
    expect(mocks.state).toHaveBeenCalledWith(record.refundTxHash, "lease", "confirmed", { sourceBlockHash: id("8") });
    expect(mocks.releaseFunder).toHaveBeenCalledWith(1, address("7"), `refund:${record.refundTxHash}`);
  });

  it("replaces an expired pending funder nonce with a higher fee after renewed approval", async () => {
    const risk = privateKeyToAccount(id("1"));
    const route = privateKeyToAccount(id("9"));
    const record = {
      operationId: id("2"), creditId: id("3"), refundTxHash: id("4"), sourceChain: 1,
      recoveryVault: address("5"), asset: address("6"), amount: "40", nonce: "2",
      deadline: Math.floor(Date.now() / 1000) + 600, refundDigest: "", riskSigner: risk.address,
      state: "pending", priorAttempts: [{
        nonce: "1", deadline: 1, refundDigest: id("a"), txHash: id("b"),
        sourceNonce: 5, maxFeePerGas: "120", maxPriorityFeePerGas: "30",
      }],
    };
    const { refundDigest, refundTypedData } = await import("../../src/recovery/refund.plan.js");
    record.refundDigest = refundDigest(record);
    const riskSignature = await risk.signTypedData(refundTypedData(record));
    mocks.config.mockReturnValue({
      sourceRpcs: { 1: "http://source" }, riskSigner: risk.address,
      routeSigner: { address: route.address, signTypedData: vi.fn().mockResolvedValue("0xsignature") },
      funder: { address: address("7") },
    });
    mocks.listPending.mockResolvedValue([{ refundTxHash: record.refundTxHash }]);
    mocks.claim.mockResolvedValue({ token: "lease", record: { ...record, riskSignature } });
    mocks.acquireFunder.mockResolvedValue(true);
    mocks.evidence.mockResolvedValue({ amount: 40n });
    mocks.source.getChainId.mockResolvedValue(1);
    mocks.source.getBlock.mockResolvedValue({ number: 12n });
    mocks.source.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "routeSigner" ? route.address : risk.address);
    mocks.source.getTransactionCount.mockImplementation(async ({ blockTag }: { blockTag: string }) =>
      blockTag === "latest" ? 5 : 6);
    mocks.source.getTransactionReceipt.mockResolvedValue(null);
    const rawTx = "0x1234";
    mocks.source.sendRawTransaction.mockResolvedValue(keccak256(rawTx));
    mocks.source.waitForTransactionReceipt.mockResolvedValue(null);
    const wallet = { prepareTransactionRequest: vi.fn().mockImplementation(async (request) => ({
      ...request, maxFeePerGas: 100n, maxPriorityFeePerGas: 20n,
    })), signTransaction: vi.fn().mockResolvedValue(rawTx) };
    mocks.wallet.mockReturnValue(wallet);
    const { runRecoveryRefundWorker } = await import("../../src/recovery/refund.worker.js");
    expect(await runRecoveryRefundWorker()).toBe(0);
    expect(wallet.prepareTransactionRequest).toHaveBeenCalledWith(expect.objectContaining({ nonce: 5 }));
    expect(wallet.signTransaction).toHaveBeenCalledWith(expect.objectContaining({
      nonce: 5, maxFeePerGas: 145n, maxPriorityFeePerGas: 37n,
    }));
    expect(mocks.prepare).toHaveBeenCalledWith(record.refundTxHash, "lease", keccak256(rawTx), rawTx, 5);
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.source.sendRawTransaction.mock.invocationCallOrder[0]!);
  });
});
