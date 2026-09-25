import { keccak256, padHex, stringToHex, type Hex, type TransactionReceipt } from "viem";
import { fetchMonadReceiptProof } from "../chain/monad-receipt-proof.js";
import { currentEthereumRecoveryOperation } from "../chain/monad-wormhole.js";
import { env } from "../config/env.js";
import type { Operation } from "./recovery.plan.js";

const topic = keccak256(stringToHex("RecoveryOperationCreated(bytes32,bytes32,address)"));

export function recoveryOperationLogIndex(receipt: TransactionReceipt, operationId: Hex, digest: Hex, inbox: Hex): number {
  if (receipt.status !== "success") throw new Error("recovery-operation-receipt-invalid");
  const inboxTopic = padHex(inbox, { size: 32 });
  const matches = receipt.logs.flatMap((log, index) =>
    log.address.toLowerCase() === env.settlementFactory.toLowerCase()
      && log.topics.length === 4 && log.topics[0]?.toLowerCase() === topic.toLowerCase()
      && log.topics[1]?.toLowerCase() === operationId.toLowerCase()
      && log.topics[2]?.toLowerCase() === digest.toLowerCase()
      && log.topics[3]?.toLowerCase() === inboxTopic.toLowerCase()
      && log.data === "0x" ? [index] : []);
  if (matches.length !== 1) throw new Error("recovery-operation-log-mismatch");
  return matches[0]!;
}

export async function fetchRecoveryOperationProof(operation: Operation, digest: Hex, wormhole = false, refresh = false) {
  if (wormhole) {
    return currentEthereumRecoveryOperation({
      factory: env.settlementFactory as Hex, operationId: operation.operationId as Hex,
      digest, inbox: operation.inbox as Hex, refresh,
    });
  }
  return fetchMonadReceiptProof({
    txHash: operation.registrationTxHash as Hex,
    selectLog: (receipt) => recoveryOperationLogIndex(
      receipt, operation.operationId as Hex, digest, operation.inbox as Hex,
    ),
  });
}
