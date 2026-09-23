import {
  createPublicClient, encodeAbiParameters, hashTypedData, http, keccak256, parseAbi, stringToHex,
  type Address, type Hex, type TransactionReceipt,
} from "viem";

const transferTopic = keccak256(stringToHex("Transfer(address,address,uint256)"));
const word = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const sourceAbi = parseAbi([
  "function asset() view returns (address)",
  "function inFlight(bytes32) view returns (bytes32 creditId,uint256 amount)",
  "function totalHeld() view returns (uint256)",
  "function usedRefundTxHash(bytes32) view returns (bool)",
]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export type RefundRecord = {
  operationId: string;
  creditId: string;
  refundTxHash: string;
  sourceChain: number;
  recoveryVault: string;
  asset: string;
  amount: string;
  nonce: string;
  deadline: number;
  refundDigest: string;
  riskSigner: string;
  riskSignature?: string;
  state?: string;
  txHash?: string;
  rawTx?: string;
  sourceNonce?: number;
  priorAttempts?: {
    nonce: string; deadline: number; refundDigest: string; txHash?: string;
    sourceNonce?: number; gasPrice?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string;
  }[];
};

export function refundTypedData(record: RefundRecord) {
  return {
    domain: {
      name: "Termbook", version: "1", chainId: record.sourceChain,
      verifyingContract: record.recoveryVault as Address,
    },
    primaryType: "RecoveryRefund",
    types: { RecoveryRefund: [
      { name: "operationId", type: "bytes32" },
      { name: "refundTxHash", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ] },
    message: {
      operationId: record.operationId as Hex,
      refundTxHash: record.refundTxHash as Hex,
      amount: BigInt(record.amount), nonce: BigInt(record.nonce), deadline: BigInt(record.deadline),
    },
  } as const;
}

export function refundDigest(record: RefundRecord): Hex {
  return hashTypedData(refundTypedData(record));
}

export function exactRefundTransfer(receipt: TransactionReceipt, token: Address, vault: Address): { amount: bigint; sender: Address } {
  if (receipt.status !== "success") throw new Error("recovery-refund-tx-failed");
  const recipientTopic = encodeAbiParameters([{ type: "address" }], [vault]);
  const matches = receipt.logs.filter((log) =>
    log.address.toLowerCase() === token.toLowerCase()
      && log.topics.length === 3 && log.topics[0]?.toLowerCase() === transferTopic.toLowerCase()
      && log.topics[2]?.toLowerCase() === recipientTopic.toLowerCase()
      && word.test(log.topics[1] ?? "") && word.test(log.data));
  if (matches.length !== 1) throw new Error("recovery-refund-transfer-ambiguous");
  const amount = BigInt(matches[0]!.data);
  if (amount === 0n) throw new Error("recovery-refund-zero");
  return { amount, sender: `0x${matches[0]!.topics[1]!.slice(-40)}` as Address };
}

export async function verifyFinalizedRefund(record: RefundRecord, rpcUrl: string): Promise<{
  amount: bigint; sender: Address; timestamp: bigint; blockHash: Hex; blockNumber: bigint;
}> {
  if (!word.test(record.operationId) || !word.test(record.creditId) || !word.test(record.refundTxHash)
    || !address.test(record.recoveryVault) || !address.test(record.asset)
    || !Number.isSafeInteger(record.sourceChain) || record.sourceChain <= 0) {
    throw new Error("recovery-refund-invalid");
  }
  const source = createPublicClient({ transport: http(rpcUrl) });
  if (await source.getChainId() !== record.sourceChain) throw new Error("recovery-refund-chain-mismatch");
  const txHash = record.refundTxHash as Hex;
  const vault = record.recoveryVault as Address;
  const asset = record.asset as Address;
  const receipt = await source.getTransactionReceipt({ hash: txHash });
  const finalized = await source.getBlock({ blockTag: "finalized" });
  if (receipt.blockNumber > finalized.number) throw new Error("recovery-refund-not-finalized");
  const canonical = await source.getBlock({ blockNumber: receipt.blockNumber });
  if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()
    || canonical.transactions[receipt.transactionIndex]?.toLowerCase() !== txHash.toLowerCase()
    || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
    throw new Error("recovery-refund-noncanonical");
  }
  const transfer = exactRefundTransfer(receipt, asset, vault);
  const amount = transfer.amount;
  const [onchainAsset, inFlight, totalHeld, used, balance] = await Promise.all([
    source.readContract({ address: vault, abi: sourceAbi, functionName: "asset", blockNumber: finalized.number }),
    source.readContract({ address: vault, abi: sourceAbi, functionName: "inFlight", args: [record.operationId as Hex], blockNumber: finalized.number }),
    source.readContract({ address: vault, abi: sourceAbi, functionName: "totalHeld", blockNumber: finalized.number }),
    source.readContract({ address: vault, abi: sourceAbi, functionName: "usedRefundTxHash", args: [txHash], blockNumber: finalized.number }),
    source.readContract({ address: asset, abi: tokenAbi, functionName: "balanceOf", args: [vault], blockNumber: finalized.number }),
  ]);
  if (onchainAsset.toLowerCase() !== asset.toLowerCase()
    || inFlight[0].toLowerCase() !== record.creditId.toLowerCase()
    || amount > inFlight[1] || used || balance < totalHeld + amount) {
    throw new Error("recovery-refund-source-mismatch");
  }
  if (record.amount && amount !== BigInt(record.amount)) throw new Error("recovery-refund-amount-mismatch");
  return { amount, sender: transfer.sender, timestamp: canonical.timestamp,
    blockHash: canonical.hash, blockNumber: canonical.number };
}
