import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex, type TransactionReceipt } from "viem";

const word = /^0x[0-9a-fA-F]{64}$/;
const appliedTopic = keccak256(stringToHex("RemoteActionApplied(bytes32,bytes32,address,uint256,uint8)"));

export function appliedLogIndex(receipt: TransactionReceipt, input: {
  vault: Address;
  actionHash: Hex;
  lockId: Hex;
  recipient: Address;
  amount: bigint;
  kind: 0 | 1;
}): number {
  if (receipt.status !== "success" || !word.test(input.actionHash) || !word.test(input.lockId)
    || input.amount <= 0n) throw new Error("source-action-receipt-invalid");
  const recipientTopic = encodeAbiParameters([{ type: "address" }], [input.recipient]);
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }], [input.amount, input.kind]);
  const matches = receipt.logs.flatMap((log, index) =>
    log.address.toLowerCase() === input.vault.toLowerCase()
      && log.topics.length === 4 && log.topics[0]?.toLowerCase() === appliedTopic.toLowerCase()
      && log.topics[1]?.toLowerCase() === input.actionHash.toLowerCase()
      && log.topics[2]?.toLowerCase() === input.lockId.toLowerCase()
      && log.topics[3]?.toLowerCase() === recipientTopic.toLowerCase()
      && log.data.toLowerCase() === data.toLowerCase() ? [index] : []);
  if (matches.length !== 1) throw new Error("source-action-log-mismatch");
  return matches[0]!;
}
