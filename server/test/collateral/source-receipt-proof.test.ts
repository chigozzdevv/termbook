import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicClient, encodeAbiParameters, keccak256, padHex, stringToHex, type TransactionReceipt } from "viem";
import { appliedLogIndex, fetchSourceAppliedProof } from "../../src/chain/source-receipt-proof.js";
import { buildEthereumSourceHeader } from "../../src/chain/ethereum-execution-header.js";
import { buildReceiptProof } from "../../src/chain/monad-receipt-proof.js";
import { env } from "../../src/config/env.js";

vi.mock("viem", async (importOriginal) => ({ ...await importOriginal<typeof import("viem")>(),
  createPublicClient: vi.fn() }));
vi.mock("../../src/chain/ethereum-execution-header.js", () => ({
  buildEthereumSourceHeader: vi.fn(async () => "0x1234"),
}));
vi.mock("../../src/chain/monad-receipt-proof.js", () => ({
  buildReceiptProof: vi.fn(() => ({ receiptsRoot: `0x${"88".repeat(32)}`, proof: "0x12" })),
}));

const vault = `0x${"11".repeat(20)}` as const;
const recipient = `0x${"22".repeat(20)}` as const;
const actionHash = `0x${"33".repeat(32)}` as const;
const lockId = `0x${"44".repeat(32)}` as const;
const topic = keccak256(stringToHex("RemoteActionApplied(bytes32,bytes32,address,uint256,uint8)"));
const txHash = `0x${"55".repeat(32)}` as const;
const blockHash = `0x${"66".repeat(32)}` as const;
const stateRoot = `0x${"77".repeat(32)}` as const;
const receiptsRoot = `0x${"88".repeat(32)}` as const;
const beaconRoot = `0x${"99".repeat(32)}` as const;
const sourceRpcUrl = env.sourceRpcUrl;

afterEach(() => {
  env.sourceRpcUrl = sourceRpcUrl;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Ethereum applied receipt proof", () => {
  it("uses the receipt-local log index and exact source action fields", () => {
    const applied = {
      address: vault, topics: [topic, actionHash, lockId, padHex(recipient, { size: 32 })],
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }], [400n, 1]),
      logIndex: 55,
    };
    const receipt = {
      status: "success", logs: [{ ...applied, address: recipient }, applied],
    } as unknown as TransactionReceipt;
    const input = { vault, actionHash, lockId, recipient, amount: 400n, kind: 1 as const };
    expect(appliedLogIndex(receipt, input)).toBe(1);
    expect(() => appliedLogIndex(receipt, { ...input, amount: 401n })).toThrow("source-action-log-mismatch");
    expect(() => appliedLogIndex({ ...receipt, logs: [...receipt.logs, applied] }, input)).toThrow("source-action-log-mismatch");
    expect(() => appliedLogIndex({ ...receipt, status: "reverted" }, input)).toThrow("source-action-receipt-invalid");
  });

  it("fetches raw RPC fields and anchors the applied receipt to the recorded Beacon root", async () => {
    env.sourceRpcUrl = "https://ethereum.example";
    const receipt = {
      status: "success", blockNumber: 10n, blockHash, transactionIndex: 0,
      transactionHash: txHash, logsBloom: `0x${"00".repeat(256)}`,
      cumulativeGasUsed: 21_000n,
      logs: [{ address: vault, topics: [topic, actionHash, lockId, padHex(recipient, { size: 32 })],
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }], [400n, 1]) }],
    } as unknown as TransactionReceipt;
    const normalized = { hash: blockHash, number: 10n, transactions: [txHash],
      stateRoot, receiptsRoot };
    const raw = { hash: blockHash, number: "0xa", stateRoot, receiptsRoot,
      requestsHash: `0x${"aa".repeat(32)}` };
    const request = vi.fn(async () => raw);
    vi.mocked(createPublicClient).mockReturnValue({
      getChainId: vi.fn(async () => 1),
      getTransactionReceipt: vi.fn(async () => receipt),
      getBlock: vi.fn(async ({ blockTag }: { blockTag?: string }) =>
        blockTag === "finalized" ? { number: 11n } : normalized),
      getBlockReceipts: vi.fn(async () => [receipt]),
      request,
    } as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      finalizedBeaconRoot: beaconRoot, blockNumber: "0xa", blockHash, receiptsRoot,
    }), { status: 200 })));
    const result = await fetchSourceAppliedProof({ txHash, vault, actionHash, lockId,
      recipient, amount: 400n, kind: 1, finalityUrl: "https://proof.example" });
    expect(request).toHaveBeenCalledWith({ method: "eth_getBlockByHash", params: [blockHash, false] });
    expect(buildEthereumSourceHeader).toHaveBeenCalledWith(raw, beaconRoot, { historicalEvent: true });
    expect(buildReceiptProof).toHaveBeenCalledWith([receipt], 0, 0);
    expect(result.header).toBe("0x1234");
  });
});
