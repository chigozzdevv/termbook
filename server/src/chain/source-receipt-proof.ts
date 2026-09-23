import {
  createPublicClient, encodeAbiParameters, http, keccak256, stringToHex,
  type Address, type Hex, type TransactionReceipt,
} from "viem";
import { env } from "../config/env.js";
import { buildEthereumSourceHeader } from "./ethereum-execution-header.js";
import { buildReceiptProof } from "./monad-receipt-proof.js";

const word = /^0x[0-9a-fA-F]{64}$/;
const appliedTopic = keccak256(stringToHex("RemoteActionApplied(bytes32,bytes32,address,uint256,uint8)"));

export type AppliedProofRequest = {
  txHash: Hex;
  vault: Address;
  actionHash: Hex;
  lockId: Hex;
  recipient: Address;
  amount: bigint;
  kind: 0 | 1;
  finalityUrl: string;
};

export function appliedLogIndex(receipt: TransactionReceipt, input: Omit<AppliedProofRequest, "txHash" | "finalityUrl">): number {
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

export async function fetchSourceAppliedProof(input: AppliedProofRequest) {
  if (!word.test(input.txHash) || !env.sourceRpcUrl) throw new Error("source-action-proof-unavailable");
  const source = createPublicClient({ transport: http(env.sourceRpcUrl) });
  if (await source.getChainId() !== 1) throw new Error("source-action-chain-mismatch");
  const receipt = await source.getTransactionReceipt({ hash: input.txHash });
  const finalized = await source.getBlock({ blockTag: "finalized" });
  if (receipt.blockNumber > finalized.number) throw new Error("source-action-not-finalized");
  const block = await source.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()
    || block.transactions[receipt.transactionIndex]?.toLowerCase() !== input.txHash.toLowerCase()
    || block.transactions.length > 4096) throw new Error("source-action-block-mismatch");
  let receipts: TransactionReceipt[];
  try {
    receipts = [...await source.getBlockReceipts({ blockHash: block.hash })];
  } catch {
    receipts = [];
    for (let offset = 0; offset < block.transactions.length; offset += 16) {
      receipts.push(...await Promise.all(block.transactions.slice(offset, offset + 16)
        .map((hash) => source.getTransactionReceipt({ hash }))));
    }
  }
  if (receipts.length !== block.transactions.length) throw new Error("source-action-receipts-incomplete");
  for (let index = 0; index < receipts.length; index += 1) {
    const item = receipts[index]!;
    if (item.transactionIndex !== index || item.blockHash.toLowerCase() !== block.hash.toLowerCase()
      || item.transactionHash.toLowerCase() !== block.transactions[index]!.toLowerCase()) {
      throw new Error("source-action-receipts-incomplete");
    }
  }
  const logIndex = appliedLogIndex(receipts[receipt.transactionIndex]!, input);
  const assembled = buildReceiptProof(receipts, receipt.transactionIndex, logIndex);
  if (assembled.receiptsRoot.toLowerCase() !== block.receiptsRoot.toLowerCase()) {
    throw new Error("source-action-receipts-root-mismatch");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(input.finalityUrl);
  } catch {
    throw new Error("source-action-proof-url-invalid");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new Error("source-action-proof-url-invalid");
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/receipt/${input.txHash}`;
  endpoint.search = "";
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
  if (!response?.ok) throw new Error("source-action-header-unavailable");
  const body = await response.text();
  if (body.length > 200_000) throw new Error("source-action-header-invalid");
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    parsed = value as Record<string, unknown>;
  } catch {
    throw new Error("source-action-header-invalid");
  }
  if (typeof parsed["finalizedBeaconRoot"] !== "string" || !word.test(parsed["finalizedBeaconRoot"])
    || typeof parsed["blockNumber"] !== "string"
    || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(parsed["blockNumber"])
    || BigInt(parsed["blockNumber"]) !== block.number
    || typeof parsed["blockHash"] !== "string" || parsed["blockHash"].toLowerCase() !== block.hash.toLowerCase()
    || typeof parsed["receiptsRoot"] !== "string"
    || parsed["receiptsRoot"].toLowerCase() !== block.receiptsRoot.toLowerCase()) {
    throw new Error("source-action-header-mismatch");
  }
  const raw: unknown = await source.request({ method: "eth_getBlockByHash", params: [block.hash, false] });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("source-action-header-mismatch");
  const selected = raw as Record<string, unknown>;
  if (typeof selected["number"] !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(selected["number"])
    || BigInt(selected["number"]) !== block.number
    || typeof selected["hash"] !== "string" || selected["hash"].toLowerCase() !== block.hash.toLowerCase()
    || typeof selected["stateRoot"] !== "string" || selected["stateRoot"].toLowerCase() !== block.stateRoot.toLowerCase()
    || typeof selected["receiptsRoot"] !== "string" || selected["receiptsRoot"].toLowerCase() !== block.receiptsRoot.toLowerCase()) {
    throw new Error("source-action-header-mismatch");
  }
  const header = await buildEthereumSourceHeader(selected, parsed["finalizedBeaconRoot"] as Hex,
    { historicalEvent: true });
  return {
    header, proof: assembled.proof,
    receiptsRoot: assembled.receiptsRoot, blockHash: block.hash,
    blockNumber: block.number, txIndex: receipt.transactionIndex, logIndex,
  };
}
