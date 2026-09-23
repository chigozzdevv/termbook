import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, padHex, stringToHex, type TransactionReceipt } from "viem";
import { appliedLogIndex } from "../../src/chain/source-receipt-proof.js";

const vault = `0x${"11".repeat(20)}` as const;
const recipient = `0x${"22".repeat(20)}` as const;
const actionHash = `0x${"33".repeat(32)}` as const;
const lockId = `0x${"44".repeat(32)}` as const;
const topic = keccak256(stringToHex("RemoteActionApplied(bytes32,bytes32,address,uint256,uint8)"));

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
});
