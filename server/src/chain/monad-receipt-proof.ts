import {
  concatHex, encodeAbiParameters, fromRlp, keccak256, numberToHex, stringToHex, toRlp,
  type Address, type Hex, type TransactionReceipt,
} from "viem";
import { monadClient } from "./monad.client.js";
import { env } from "../config/env.js";

type Rlp = Hex | Rlp[];
type Entry = { key: number[]; value: Hex };
type TrieNode =
  | { kind: "leaf"; path: number[]; value: Hex; encoded?: Hex; rlp?: Rlp }
  | { kind: "extension"; path: number[]; child: TrieNode; encoded?: Hex; rlp?: Rlp }
  | { kind: "branch"; children: (TrieNode | null)[]; value: Hex; encoded?: Hex; rlp?: Rlp };

const word = /^0x[0-9a-fA-F]{64}$/;
const bloom = /^0x[0-9a-fA-F]{512}$/;
const eventTopic = keccak256(stringToHex("RemoteActionAuthorized(bytes32,bytes32,uint8)"));
const typeByte: Record<string, number> = {
  legacy: 0, eip2930: 1, eip1559: 2, eip4844: 3, eip7702: 4,
};

function quantity(value: bigint): Hex {
  if (value < 0n) throw new Error("receipt-invalid");
  return value === 0n ? "0x" : numberToHex(value);
}

function bytes(hex: Hex): number[] {
  const result: number[] = [];
  for (let i = 2; i < hex.length; i += 2) result.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return result;
}

function nibbles(hex: Hex): number[] {
  return bytes(hex).flatMap((byte) => [byte >> 4, byte & 15]);
}

function compact(path: number[], leaf: boolean): Hex {
  const prefix = leaf ? 2 : 0;
  const packed = path.length % 2 === 0 ? [prefix, 0, ...path] : [prefix + 1, ...path];
  let result = "0x";
  for (let i = 0; i < packed.length; i += 2) result += (packed[i]! * 16 + packed[i + 1]!).toString(16).padStart(2, "0");
  return result as Hex;
}

function build(entries: Entry[], offset = 0): TrieNode {
  if (entries.length === 1) return { kind: "leaf", path: entries[0]!.key.slice(offset), value: entries[0]!.value };
  let common = 0;
  while (entries.every((entry) => entry.key[offset + common] !== undefined
    && entry.key[offset + common] === entries[0]!.key[offset + common])) common += 1;
  if (common > 0) return {
    kind: "extension", path: entries[0]!.key.slice(offset, offset + common), child: build(entries, offset + common),
  };
  const children: (TrieNode | null)[] = Array.from({ length: 16 }, () => null);
  let value: Hex = "0x";
  for (let index = 0; index < 16; index += 1) {
    const group = entries.filter((entry) => entry.key[offset] === index);
    if (group.length > 0) children[index] = build(group, offset + 1);
  }
  const terminal = entries.find((entry) => entry.key.length === offset);
  if (terminal) value = terminal.value;
  return { kind: "branch", children, value };
}

function encode(node: TrieNode): Hex {
  if (node.encoded) return node.encoded;
  const reference = (child: TrieNode | null): Rlp => {
    if (!child) return "0x";
    const encoded = encode(child);
    return (encoded.length - 2) / 2 < 32 ? child.rlp! : keccak256(encoded);
  };
  const rlp: Rlp = node.kind === "leaf"
    ? [compact(node.path, true), node.value]
    : node.kind === "extension"
      ? [compact(node.path, false), reference(node.child)]
      : [...node.children.map(reference), node.value];
  node.rlp = rlp;
  node.encoded = toRlp(rlp);
  return node.encoded;
}

function proofNodes(root: TrieNode, key: number[]): Hex[] {
  const result: Hex[] = [];
  let node = root;
  let offset = 0;
  while (true) {
    const encoded = encode(node);
    if (node === root || (encoded.length - 2) / 2 >= 32) result.push(encoded);
    if (node.kind === "leaf") {
      if (node.path.join() !== key.slice(offset).join()) throw new Error("receipt-key-missing");
      return result;
    }
    if (node.kind === "extension") {
      if (node.path.join() !== key.slice(offset, offset + node.path.length).join()) throw new Error("receipt-key-missing");
      offset += node.path.length;
      node = node.child;
      continue;
    }
    const child = node.children[key[offset]!];
    if (!child) throw new Error("receipt-key-missing");
    offset += 1;
    node = child;
  }
}

export function encodeReceipt(receipt: TransactionReceipt): Hex {
  if (!bloom.test(receipt.logsBloom) || receipt.cumulativeGasUsed < 0n
    || (receipt.status !== "success" && receipt.status !== "reverted")) throw new Error("receipt-invalid");
  const logs: Rlp[] = receipt.logs.map((log) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(log.address) || !/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data)
      || log.topics.some((topic) => !word.test(topic))) throw new Error("receipt-invalid");
    return [log.address, [...log.topics], log.data];
  });
  const payload = toRlp([
    receipt.status === "success" ? "0x01" : "0x", quantity(receipt.cumulativeGasUsed), receipt.logsBloom, logs,
  ]);
  const type = typeByte[receipt.type];
  if (type === undefined) throw new Error("receipt-type-unsupported");
  return type === 0 ? payload : concatHex([numberToHex(type, { size: 1 }), payload]);
}

function buildEncodedReceiptProof(receipts: Hex[], txIndex: number, logIndex: number) {
  if (!Number.isSafeInteger(txIndex) || txIndex < 0 || txIndex >= receipts.length
    || !Number.isSafeInteger(logIndex) || logIndex < 0 || logIndex >= 512) {
    throw new Error("receipt-index-invalid");
  }
  const entries = receipts.map((value, index) => ({
    key: nibbles(toRlp(quantity(BigInt(index)))), value,
  }));
  if (entries.some((entry) => !/^0x(?:[0-9a-fA-F]{2})+$/.test(entry.value))) {
    throw new Error("receipt-invalid");
  }
  if (entries.some((entry) => (entry.value.length - 2) / 2 > 64_000)
    || entries.reduce((size, entry) => size + (entry.value.length - 2) / 2, 0) > 32_000_000) {
    throw new Error("receipt-proof-too-large");
  }
  const root = build(entries);
  const receiptsRoot = keccak256(encode(root));
  const nodes = proofNodes(root, entries[txIndex]!.key);
  if (nodes.length > 64 || nodes.some((node) => (node.length - 2) / 2 > 96_000)) throw new Error("receipt-proof-too-large");
  const proof = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "bytes[]" }],
    [BigInt(txIndex), BigInt(logIndex), nodes],
  );
  if ((proof.length - 2) / 2 > 160_000) throw new Error("receipt-proof-too-large");
  return { receiptsRoot, proof, nodes };
}

export function buildReceiptProof(receipts: TransactionReceipt[], txIndex: number, logIndex: number) {
  if (!Number.isSafeInteger(txIndex) || txIndex < 0 || txIndex >= receipts.length
    || !Number.isSafeInteger(logIndex) || logIndex < 0 || logIndex >= receipts[txIndex]!.logs.length) {
    throw new Error("receipt-index-invalid");
  }
  return buildEncodedReceiptProof(receipts.map(encodeReceipt), txIndex, logIndex);
}

export async function fetchMonadReceiptProof(input: {
  txHash: Hex;
  selectLog: (receipt: TransactionReceipt) => number;
}) {
  if (!word.test(input.txHash)) throw new Error("authorization-tx-invalid");
  const chain = monadClient();
  const receipt = await chain.getTransactionReceipt({ hash: input.txHash });
  const chainId = await chain.getChainId();
  if ((chainId !== 143 && chainId !== 10143) || chainId !== env.monadChainId) {
    throw new Error("authorization-monad-chain-unsupported");
  }
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (receipt.blockNumber + 3n > finalized.number) throw new Error("authorization-not-verified");
  const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()
    || block.transactions[receipt.transactionIndex]?.toLowerCase() !== input.txHash.toLowerCase()) {
    throw new Error("authorization-block-mismatch");
  }
  if (block.transactions.length === 0 || block.transactions.length > 4096) {
    throw new Error("authorization-receipts-incomplete");
  }
  const raw: unknown = await chain.request({ method: "debug_getRawReceipts",
    params: [numberToHex(block.number)] } as never).catch(() => null);
  let eventIndex: number;
  let assembled: ReturnType<typeof buildReceiptProof>;
  if (raw !== null) {
    if (!Array.isArray(raw) || raw.length !== block.transactions.length
      || raw.some((item) => typeof item !== "string")) {
      throw new Error("authorization-receipts-incomplete");
    }
    const receipts = raw as Hex[];
    if (receipts[receipt.transactionIndex]!.toLowerCase() !== encodeReceipt(receipt).toLowerCase()) {
      throw new Error("authorization-receipt-mismatch");
    }
    eventIndex = input.selectLog(receipt);
    assembled = buildEncodedReceiptProof(receipts, receipt.transactionIndex, eventIndex);
  } else {
    let receipts: TransactionReceipt[];
    try {
      receipts = [...await chain.getBlockReceipts({ blockHash: block.hash })];
    } catch {
      receipts = [];
      for (let offset = 0; offset < block.transactions.length; offset += 16) {
        receipts.push(...await Promise.all(block.transactions.slice(offset, offset + 16)
          .map((hash) => chain.getTransactionReceipt({ hash }))));
      }
    }
    if (receipts.length !== block.transactions.length || receipts.length > 4096) {
      throw new Error("authorization-receipts-incomplete");
    }
    for (let index = 0; index < receipts.length; index += 1) {
      const item = receipts[index]!;
      if (item.transactionIndex !== index || item.blockHash.toLowerCase() !== block.hash.toLowerCase()
        || item.transactionHash.toLowerCase() !== block.transactions[index]!.toLowerCase()) {
        throw new Error("authorization-receipts-incomplete");
      }
    }
    eventIndex = input.selectLog(receipts[receipt.transactionIndex]!);
    assembled = buildReceiptProof(receipts, receipt.transactionIndex, eventIndex);
  }
  if (assembled.receiptsRoot.toLowerCase() !== block.receiptsRoot.toLowerCase()) {
    throw new Error("authorization-receipts-root-mismatch");
  }
  const header: unknown = await chain.request({ method: "debug_getRawHeader",
    params: [numberToHex(block.number)] } as never).catch(() => null);
  if (typeof header !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(header)
    || header.length > 192_002) throw new Error("authorization-header-unavailable");
  let fields: unknown;
  try {
    fields = fromRlp(header as Hex);
  } catch {
    throw new Error("authorization-header-invalid");
  }
  if (!Array.isArray(fields) || (fields.length !== 20 && fields.length !== 21)
    || typeof fields[5] !== "string" || typeof fields[8] !== "string"
    || typeof fields[11] !== "string" || keccak256(header as Hex).toLowerCase() !== block.hash.toLowerCase()
    || fields[5].toLowerCase() !== block.receiptsRoot.toLowerCase()
    || !/^0x(?:[0-9a-fA-F]{2})+$/.test(fields[8])
    || !/^0x(?:[0-9a-fA-F]{2})+$/.test(fields[11])
    || BigInt(fields[8]) !== block.number || BigInt(fields[11]) !== block.timestamp) {
    throw new Error("authorization-header-mismatch");
  }
  return {
    header: header as Hex, proof: assembled.proof,
    receiptsRoot: assembled.receiptsRoot, blockHash: block.hash,
    blockNumber: block.number, txIndex: receipt.transactionIndex, logIndex: eventIndex,
  };
}

export async function fetchMonadAuthorizationProof(input: {
  txHash: Hex;
  core: Address;
  creditId: Hex;
  actionHash: Hex;
  kind: 0 | 1;
}) {
  return fetchMonadReceiptProof({
    txHash: input.txHash,
    selectLog: (receipt) => authorizationLogIndex(receipt, input.core, input.creditId, input.actionHash, input.kind),
  });
}

export function authorizationLogIndex(
  receipt: TransactionReceipt, core: Address, creditId: Hex, actionHash: Hex, kind: 0 | 1,
): number {
  if (receipt.status !== "success" || !word.test(creditId) || !word.test(actionHash)) throw new Error("authorization-receipt-invalid");
  const data = encodeAbiParameters([{ type: "uint8" }], [kind]);
  const matches = receipt.logs.flatMap((log, index) =>
    log.address.toLowerCase() === core.toLowerCase()
      && log.topics.length === 3 && log.topics[0]?.toLowerCase() === eventTopic.toLowerCase()
      && log.topics[1]?.toLowerCase() === creditId.toLowerCase()
      && log.topics[2]?.toLowerCase() === actionHash.toLowerCase()
      && log.data.toLowerCase() === data.toLowerCase() ? [index] : []);
  if (matches.length !== 1) throw new Error("authorization-log-mismatch");
  return matches[0]!;
}
