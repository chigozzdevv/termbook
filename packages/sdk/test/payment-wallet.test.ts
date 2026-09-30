import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi } from "viem";
import { evmPaymentWallet, verifyPaymentTransfer, verifySourceRefund } from "../src/settlement/payment-wallet.js";
import type { PaymentRoute } from "../src/settlement/payment-types.js";
import type { SettlementRegistration } from "../src/settlement/settlement.js";
const chain = vi.hoisted(() => ({ getChainId: vi.fn(), getTransactionReceipt: vi.fn(), getBlock: vi.fn(), getTransaction: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({ ...await importOriginal<typeof import("viem")>(), createPublicClient: () => chain }));
const a = (n: string) => `0x${n.repeat(40)}` as `0x${string}`;
const w = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;
const sender = a("1"), deposit = a("2"), token = a("3"), hash = w("4");
const route = { sourceChain: 1, sourceAddressFormat: "evm", sourceAsset: token, sourceRpcUrl: "https://source.example", sourceKind: "erc20" } as PaymentRoute;
const registration = { depositAddress: deposit, amountIn: 100n, sourceRefundRecipient: sender } as SettlementRegistration;
const transfer = parseAbi(["function transfer(address,uint256) returns (bool)", "event Transfer(address indexed from,address indexed to,uint256 value)"]);
function log(to: `0x${string}`, amount = 100n) {
  return { address: token, topics: encodeEventTopics({ abi: transfer, eventName: "Transfer", args: { from: sender, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]) };
}
beforeEach(() => {
  vi.clearAllMocks(); chain.getChainId.mockResolvedValue(1);
  chain.getBlock.mockResolvedValue({ number: 10n, hash, transactions: [hash] });
  chain.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 10n, blockHash: hash, transactionIndex: 0, logs: [log(deposit)] });
  chain.getTransaction.mockResolvedValue({ from: sender, to: token, value: 0n,
    input: encodeFunctionData({ abi: transfer, functionName: "transfer", args: [deposit, 100n] }) });
});
describe("source payment verification", () => {
  it("requires finalized canonical delivery of the exact token amount", async () => {
    expect(await verifyPaymentTransfer(route, registration, hash, sender)).toBe(true);
    chain.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 11n });
    expect(await verifyPaymentTransfer(route, registration, hash, sender)).toBe(false);
  });
  it("rejects fee tokens, wrong senders, and noncanonical receipts", async () => {
    chain.getTransactionReceipt.mockResolvedValueOnce({ status: "success", blockNumber: 10n, blockHash: hash, transactionIndex: 0, logs: [log(deposit, 99n)] });
    await expect(verifyPaymentTransfer(route, registration, hash, sender)).rejects.toThrow("source-transfer-invalid");
    await expect(verifyPaymentTransfer(route, registration, hash, a("8"))).rejects.toThrow("source-transfer-invalid");
    chain.getBlock.mockResolvedValue({ number: 10n, hash: w("f"), transactions: [hash] });
    await expect(verifyPaymentTransfer(route, registration, hash, sender)).rejects.toThrow("source-transfer-invalid");
  });
  it("checks the source wallet chain before asking for a transfer", async () => {
    const writeContract = vi.fn(); const wallet = evmPaymentWallet({ address: sender, getChainId: async () => 143, writeContract, signTypedData: vi.fn() });
    await expect(wallet.fund(registration, route, vi.fn())).rejects.toThrow("source-wallet-chain-mismatch");
    expect(writeContract).not.toHaveBeenCalled();
  });
  it("does not count unrelated outgoing payments as a source refund", async () => {
    expect(await verifySourceRefund(route, registration, [hash], 100n)).toBe(false);
    chain.getTransactionReceipt.mockResolvedValue({ status: "success", blockNumber: 10n, blockHash: hash, transactionIndex: 0, logs: [log(sender)] });
    expect(await verifySourceRefund(route, registration, [hash, hash], 100n)).toBe(true);
    expect(await verifySourceRefund(route, registration, [hash], 101n)).toBe(false);
  });
});
