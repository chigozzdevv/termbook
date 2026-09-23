import { afterEach, describe, expect, it } from "vitest";
import { keccak256, padHex, stringToHex, type TransactionReceipt } from "viem";
import { env } from "../../src/config/env.js";
import { recoveryOperationLogIndex } from "../../src/recovery/recovery.proof.js";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const id = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const factory = address("a");
const operationId = id("1");
const digest = id("2");
const inbox = address("b");
const originalFactory = env.settlementFactory;

afterEach(() => { env.settlementFactory = originalFactory; });

describe("recovery operation receipt", () => {
  it("selects only the exact successful factory event", () => {
    env.settlementFactory = factory;
    const topic = keccak256(stringToHex("RecoveryOperationCreated(bytes32,bytes32,address)"));
    const receipt = {
      status: "success",
      logs: [
        { address: factory, topics: [topic, operationId, digest, padHex(inbox, { size: 32 })], data: "0x" },
      ],
    } as TransactionReceipt;
    expect(recoveryOperationLogIndex(receipt, operationId, digest, inbox)).toBe(0);
    expect(() => recoveryOperationLogIndex(receipt, operationId, id("3"), inbox)).toThrow("recovery-operation-log-mismatch");
    expect(() => recoveryOperationLogIndex({ ...receipt, status: "reverted" }, operationId, digest, inbox))
      .toThrow("recovery-operation-receipt-invalid");
  });
});
