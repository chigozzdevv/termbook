import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, stringToHex, type TransactionReceipt } from "viem";

const source = vi.hoisted(() => ({
  getChainId: vi.fn(), getTransactionReceipt: vi.fn(), getBlock: vi.fn(), readContract: vi.fn(),
}));
vi.mock("viem", async (load) => ({
  ...await load<typeof import("viem")>(), createPublicClient: () => source,
}));

const id = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const transferTopic = keccak256(stringToHex("Transfer(address,address,uint256)"));
const asset = address("a");
const vault = address("b");
const sender = address("c");
const record = {
  operationId: id("1"), creditId: id("2"), refundTxHash: id("3"), sourceChain: 1,
  recoveryVault: vault, asset, amount: "40", nonce: "1", deadline: 1000,
  refundDigest: id("4"), riskSigner: address("d"),
};
const transfer = (amount: bigint, token = asset, recipient = vault) => ({
  address: token,
  topics: [transferTopic, encodeAbiParameters([{ type: "address" }], [sender]),
    encodeAbiParameters([{ type: "address" }], [recipient])],
  data: encodeAbiParameters([{ type: "uint256" }], [amount]),
});
const receipt = (logs = [transfer(40n)]) => ({
  status: "success", logs, blockNumber: 10n, blockHash: id("5"),
  transactionHash: record.refundTxHash, transactionIndex: 0,
}) as unknown as TransactionReceipt;

afterEach(() => vi.resetAllMocks());

describe("finalized recovery refund proof", () => {
  it("binds one ERC20 transfer to the canonical transaction and outstanding operation", async () => {
    source.getChainId.mockResolvedValue(1);
    source.getTransactionReceipt.mockResolvedValue(receipt());
    source.getBlock.mockImplementation(async ({ blockTag }: { blockTag?: string }) =>
      blockTag === "finalized" ? { number: 12n } : {
        number: 10n, hash: id("5"), timestamp: 100n, transactions: [record.refundTxHash],
      });
    source.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => ({
      asset, inFlight: [record.creditId, 80n], totalHeld: 10n,
      usedRefundTxHash: false, balanceOf: 50n,
    })[functionName]);
    const { verifyFinalizedRefund } = await import("../../src/recovery/refund.plan.js");
    await expect(verifyFinalizedRefund(record, "http://source")).resolves.toMatchObject({
      amount: 40n, sender, blockHash: id("5"), blockNumber: 10n,
    });
    expect(source.readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "inFlight", args: [record.operationId], blockNumber: 12n,
    }));
  });

  it("rejects batched or failed transfers and exact asset mismatches", async () => {
    const { exactRefundTransfer } = await import("../../src/recovery/refund.plan.js");
    expect(() => exactRefundTransfer(receipt([transfer(20n), transfer(20n)]), asset, vault))
      .toThrow("recovery-refund-transfer-ambiguous");
    expect(() => exactRefundTransfer(receipt([transfer(40n, address("e"))]), asset, vault))
      .toThrow("recovery-refund-transfer-ambiguous");
    expect(() => exactRefundTransfer({ ...receipt(), status: "reverted" } as TransactionReceipt, asset, vault))
      .toThrow("recovery-refund-tx-failed");
    expect(() => exactRefundTransfer(receipt([transfer(0n)]), asset, vault)).toThrow("recovery-refund-zero");
  });

  it("rejects a noncanonical or already consumed source transaction", async () => {
    source.getChainId.mockResolvedValue(1);
    source.getTransactionReceipt.mockResolvedValue(receipt());
    source.getBlock.mockImplementation(async ({ blockTag }: { blockTag?: string }) =>
      blockTag === "finalized" ? { number: 12n } : {
        number: 10n, hash: id("6"), timestamp: 100n, transactions: [record.refundTxHash],
      });
    const { verifyFinalizedRefund } = await import("../../src/recovery/refund.plan.js");
    await expect(verifyFinalizedRefund(record, "http://source")).rejects.toThrow("recovery-refund-noncanonical");
    source.getBlock.mockImplementation(async ({ blockTag }: { blockTag?: string }) =>
      blockTag === "finalized" ? { number: 12n } : {
        number: 10n, hash: id("5"), timestamp: 100n, transactions: [record.refundTxHash],
      });
    source.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => ({
      asset, inFlight: [record.creditId, 80n], totalHeld: 10n,
      usedRefundTxHash: true, balanceOf: 50n,
    })[functionName]);
    await expect(verifyFinalizedRefund(record, "http://source")).rejects.toThrow("recovery-refund-source-mismatch");
  });
});
