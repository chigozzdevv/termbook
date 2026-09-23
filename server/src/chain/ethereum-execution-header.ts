import { encodeAbiParameters, keccak256, toRlp, type Address, type Hex } from "viem";
import { env } from "../config/env.js";
import { monadClient } from "./monad.client.js";

const word = /^0x[0-9a-fA-F]{64}$/;
const account = /^0x[0-9a-fA-F]{40}$/;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const dataPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const emptyAddress = "0x0000000000000000000000000000000000000000";
const maxHeaderBytes = 4096;

const coreAbi = [{ type: "function", name: "verifierRegistry", stateMutability: "view", inputs: [],
  outputs: [{ type: "address" }] }] as const;
const registryAbi = [{ type: "function", name: "verifiers", stateMutability: "view",
  inputs: [{ type: "uint256" }], outputs: [
    { type: "address" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "bytes32" },
  ] }] as const;
const verifierAbi = [{ type: "function", name: "verifyFinality", stateMutability: "view",
  inputs: [{ type: "bytes" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "lightClient", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] }] as const;
const beaconAbi = [
  { type: "function", name: "finalizedExecution", stateMutability: "view",
    inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes32" }, { type: "uint64" }] },
  { type: "function", name: "genesisTime", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "verifyHistoricalFinality", stateMutability: "view",
    inputs: [{ type: "bytes" }], outputs: [{ type: "bool" }] },
] as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("source-header-invalid");
  return value as Record<string, unknown>;
}

function fixed(value: unknown, length: number): Hex {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${length * 2}}$`).test(value)) {
    throw new Error("source-header-invalid");
  }
  return value.toLowerCase() as Hex;
}

function bytes(value: unknown, maxLength: number): Hex {
  if (typeof value !== "string" || !dataPattern.test(value) || (value.length - 2) / 2 > maxLength) {
    throw new Error("source-header-invalid");
  }
  return value.toLowerCase() as Hex;
}

function quantity(value: unknown, maxLength = 32): { encoded: Hex; number: bigint } {
  if (typeof value !== "string" || !quantityPattern.test(value)) throw new Error("source-header-invalid");
  const number = BigInt(value);
  if (number >= 1n << BigInt(maxLength * 8)) throw new Error("source-header-invalid");
  if (number === 0n) return { encoded: "0x", number };
  let digits = number.toString(16);
  if (digits.length % 2) digits = `0${digits}`;
  return { encoded: `0x${digits}` as Hex, number };
}

export type EthereumExecutionHeader = {
  rlp: Hex;
  blockHash: Hex;
  stateRoot: Hex;
  receiptsRoot: Hex;
  timestamp: bigint;
  number: bigint;
  fieldCount: number;
};

export function encodeEthereumExecutionHeader(value: unknown): EthereumExecutionHeader {
  const block = record(value);
  const blockHash = fixed(block["hash"], 32);
  const stateRoot = fixed(block["stateRoot"], 32);
  const receiptsRoot = fixed(block["receiptsRoot"], 32);
  const mixHash = fixed(block["mixHash"] ?? block["prevRandao"], 32);
  if (block["mixHash"] != null && block["prevRandao"] != null
    && fixed(block["prevRandao"], 32) !== mixHash) throw new Error("source-header-invalid");
  const number = quantity(block["number"], 8);
  const timestamp = quantity(block["timestamp"], 8);
  if (stateRoot === `0x${"00".repeat(32)}` || receiptsRoot === `0x${"00".repeat(32)}`
    || timestamp.number === 0n) throw new Error("source-header-invalid");
  const fields: Hex[] = [
    fixed(block["parentHash"], 32),
    fixed(block["sha3Uncles"], 32),
    fixed(block["miner"], 20),
    stateRoot,
    fixed(block["transactionsRoot"], 32),
    receiptsRoot,
    fixed(block["logsBloom"], 256),
    quantity(block["difficulty"]).encoded,
    number.encoded,
    quantity(block["gasLimit"], 8).encoded,
    quantity(block["gasUsed"], 8).encoded,
    timestamp.encoded,
    bytes(block["extraData"], 32),
    mixHash,
    fixed(block["nonce"], 8),
  ];
  if (block["baseFeePerGas"] != null) fields.push(quantity(block["baseFeePerGas"]).encoded);
  if (block["withdrawalsRoot"] != null) {
    if (fields.length !== 16) throw new Error("source-header-invalid");
    fields.push(fixed(block["withdrawalsRoot"], 32));
  }
  const blobFields = [block["blobGasUsed"], block["excessBlobGas"], block["parentBeaconBlockRoot"]];
  if (blobFields.some((field) => field != null)) {
    if (fields.length !== 17 || blobFields.some((field) => field == null)) {
      throw new Error("source-header-invalid");
    }
    fields.push(quantity(blobFields[0], 8).encoded, quantity(blobFields[1], 8).encoded,
      fixed(blobFields[2], 32));
  }
  if (block["requestsHash"] != null) {
    if (fields.length !== 20) throw new Error("source-header-invalid");
    fields.push(fixed(block["requestsHash"], 32));
  }
  if (block["blockAccessListHash"] != null || block["slotNumber"] != null) {
    throw new Error("source-header-unsupported");
  }
  if (![15, 16, 17, 20, 21].includes(fields.length)) throw new Error("source-header-invalid");
  const rlp = toRlp(fields);
  if ((rlp.length - 2) / 2 > maxHeaderBytes) throw new Error("source-header-invalid");
  if (keccak256(rlp) !== blockHash) throw new Error("source-header-hash-mismatch");
  return { rlp, blockHash, stateRoot, receiptsRoot, timestamp: timestamp.number,
    number: number.number, fieldCount: fields.length };
}

export function packageEthereumHeader(header: EthereumExecutionHeader, finalizedBeaconRoot: Hex): Hex {
  if (!word.test(finalizedBeaconRoot) || BigInt(finalizedBeaconRoot) === 0n
    || (header.fieldCount !== 20 && header.fieldCount !== 21)) throw new Error("source-header-unsupported");
  const consensusProof = encodeAbiParameters([{ type: "bytes32" }], [finalizedBeaconRoot]);
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [header.rlp, consensusProof]);
}

export async function assertEthereumHeaderAdmitted(input: {
  header: Hex; blockHash: Hex; timestamp: bigint; finalizedBeaconRoot: Hex;
  historicalEvent?: boolean;
}): Promise<void> {
  if (!account.test(env.core) || env.core.toLowerCase() === emptyAddress) {
    throw new Error("source-header-anchor-unavailable");
  }
  try {
    const client = monadClient();
    const registry = await client.readContract({ address: env.core as Address, abi: coreAbi,
      functionName: "verifierRegistry" });
    if (registry.toLowerCase() === emptyAddress) throw new Error("source-header-anchor-unavailable");
    const [verifier, , active] = await client.readContract({ address: registry, abi: registryAbi,
      functionName: "verifiers", args: [1n] });
    if (!active || verifier.toLowerCase() === emptyAddress) throw new Error("source-header-anchor-unavailable");
    const beacon = await client.readContract({ address: verifier, abi: verifierAbi,
      functionName: "lightClient" });
    if (beacon.toLowerCase() === emptyAddress) throw new Error("source-header-anchor-unavailable");
    const [recordedHash, slot] = await client.readContract({ address: beacon, abi: beaconAbi,
      functionName: "finalizedExecution", args: [input.finalizedBeaconRoot] });
    const genesisTime = await client.readContract({ address: beacon, abi: beaconAbi,
      functionName: "genesisTime" });
    if (recordedHash.toLowerCase() !== input.blockHash || slot === 0n
      || genesisTime + slot * 12n !== input.timestamp) throw new Error("source-header-anchor-unavailable");
    const admitted = input.historicalEvent
      ? await client.readContract({ address: beacon, abi: beaconAbi,
        functionName: "verifyHistoricalFinality", args: [input.header] })
      : await client.readContract({ address: verifier, abi: verifierAbi,
        functionName: "verifyFinality", args: [input.header] });
    if (!admitted) throw new Error("source-header-anchor-unavailable");
  } catch {
    throw new Error("source-header-anchor-unavailable");
  }
}

export async function buildEthereumSourceHeader(block: unknown, finalizedBeaconRoot: Hex,
  options: { historicalEvent?: boolean } = {}): Promise<Hex> {
  const execution = encodeEthereumExecutionHeader(block);
  const header = packageEthereumHeader(execution, finalizedBeaconRoot);
  await assertEthereumHeaderAdmitted({ header, blockHash: execution.blockHash,
    timestamp: execution.timestamp, finalizedBeaconRoot, historicalEvent: options.historicalEvent });
  return header;
}
