import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { env } from "../config/env.js";
import { fetchFinalizedBeaconExecution } from "./ethereum-beacon-proof.js";
import { buildEthereumSourceHeader } from "./ethereum-execution-header.js";

const word = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const quantity = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const node = /^0x(?:[0-9a-fA-F]{2})+$/;

export type ProofBundle = {
  header: Hex;
  proof: Hex;
  blockNumber: string;
  blockHash: Hex;
  stateRoot: Hex;
  slot: Hex;
  codeHash: Hex;
};

export type ProofRequest = {
  rpcUrl: string;
  lockId: Hex;
  vault: Address;
  commitment: Hex;
  expectedCodeHash: Hex;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("proof-invalid");
  return value as Record<string, unknown>;
}

function hex(value: unknown, pattern: RegExp): Hex {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error("proof-invalid");
  return value.toLowerCase() as Hex;
}

function url(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("proof-invalid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("proof-invalid");
  return parsed;
}

async function jsonResponse(response: Response, maxChars: number): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error("proof-unavailable");
  const body = await response.text();
  if (body.length > maxChars) throw new Error("proof-invalid");
  try {
    return object(JSON.parse(body));
  } catch {
    throw new Error("proof-invalid");
  }
}

async function rpc(endpoint: URL, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  }).catch(() => null);
  if (!response) throw new Error("proof-unavailable");
  const payload = await jsonResponse(response, 1_000_000);
  if (payload["jsonrpc"] !== "2.0" || payload["id"] !== 1 || payload["error"] || payload["result"] == null) {
    throw new Error("proof-unavailable");
  }
  return payload["result"];
}

async function finalizedAnchor(source: URL) {
  if (!env.sourceBeaconApiUrl) throw new Error("proof-beacon-unavailable");
  const beacon = await fetchFinalizedBeaconExecution(env.sourceBeaconApiUrl);
  const block = object(await rpc(source, "eth_getBlockByHash", [beacon.executionBlockHash, false]));
  if (hex(block["hash"], word) !== beacon.executionBlockHash) throw new Error("proof-block-mismatch");
  return {
    finalizedBeaconRoot: beacon.finalizedBeaconRoot,
    blockNumber: hex(block["number"], quantity),
    blockHash: beacon.executionBlockHash,
    stateRoot: hex(block["stateRoot"], word),
  };
}

function proofNodes(value: unknown, allowEmpty = false): Hex[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 64) throw new Error("proof-invalid");
  return value.map((entry: unknown) => {
    const encoded = hex(entry, node);
    if ((encoded.length - 2) / 2 > 2048) throw new Error("proof-invalid");
    return encoded;
  });
}

export function consumedActionSlot(actionHash: Hex): Hex {
  hex(actionHash, word);
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [actionHash, 0n]));
}

export async function fetchUnconsumedActionProof(input: {
  rpcUrl: string;
  actionHash: Hex;
  controller: Address;
  expectedCodeHash: Hex;
  deadline: bigint;
}): Promise<ProofBundle> {
  const source = url(input.rpcUrl);
  const actionHash = hex(input.actionHash, word);
  const controller = hex(input.controller, address);
  const expectedCodeHash = hex(input.expectedCodeHash, word);
  if (BigInt(actionHash) === 0n || BigInt(expectedCodeHash) === 0n || input.deadline <= 0n) {
    throw new Error("proof-invalid");
  }
  const slot = consumedActionSlot(actionHash);
  const chainId = hex(await rpc(source, "eth_chainId", []), quantity);
  if (BigInt(chainId) !== 1n) throw new Error("source-chain-mismatch");
  const { finalizedBeaconRoot, blockNumber, blockHash, stateRoot } =
    await finalizedAnchor(source);
  const finalized = object(await rpc(source, "eth_getBlockByNumber", ["finalized", false]));
  const finalizedNumber = hex(finalized["number"], quantity);
  if (BigInt(blockNumber) > BigInt(finalizedNumber)) throw new Error("proof-not-finalized");
  const selected = object(await rpc(source, "eth_getBlockByNumber", [blockNumber, false]));
  if (hex(selected["number"], quantity) !== blockNumber || hex(selected["hash"], word) !== blockHash
    || hex(selected["stateRoot"], word) !== stateRoot) throw new Error("proof-block-mismatch");
  const timestamp = hex(selected["timestamp"], quantity);
  if (BigInt(timestamp) <= input.deadline) throw new Error("proof-before-deadline");
  const header = await buildEthereumSourceHeader(selected, finalizedBeaconRoot);
  const result = object(await rpc(source, "eth_getProof", [controller, [slot], { blockHash, requireCanonical: true }]));
  if (hex(result["address"], address) !== controller) throw new Error("proof-account-mismatch");
  const codeHash = hex(result["codeHash"], word);
  if (codeHash !== expectedCodeHash) throw new Error("proof-code-mismatch");
  const accountNodes = proofNodes(result["accountProof"]);
  const storageHash = hex(result["storageHash"], word);
  const storageProofs = result["storageProof"];
  if (!Array.isArray(storageProofs) || storageProofs.length !== 1) throw new Error("proof-invalid");
  const storage = object(storageProofs[0]);
  const key = hex(storage["key"], /^0x[0-9a-fA-F]{1,64}$/);
  const value = hex(storage["value"], quantity);
  if (BigInt(key) !== BigInt(slot) || BigInt(value) !== 0n) throw new Error("proof-consumed");
  const storageNodes = proofNodes(storage["proof"], storageHash === keccak256("0x80"));
  if (storageNodes.length === 0 && storageHash !== keccak256("0x80")) throw new Error("proof-invalid");
  const proof = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes[]" }, { type: "bytes[]" }],
    [actionHash, accountNodes, storageNodes],
  );
  if ((proof.length - 2) / 2 > 96_000) throw new Error("proof-invalid");
  return { header, proof, blockNumber, blockHash, stateRoot, slot, codeHash };
}

export function lockCommitmentSlot(lockId: Hex): Hex {
  hex(lockId, word);
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [lockId, 6n]));
}

export async function fetchProof(input: ProofRequest): Promise<ProofBundle> {
  const source = url(input.rpcUrl);
  const lockId = hex(input.lockId, word);
  const vault = hex(input.vault, address);
  const commitment = hex(input.commitment, word);
  const expectedCodeHash = hex(input.expectedCodeHash, word);
  if (BigInt(commitment) === 0n || BigInt(expectedCodeHash) === 0n) throw new Error("proof-invalid");
  const slot = lockCommitmentSlot(lockId);
  const chainId = hex(await rpc(source, "eth_chainId", []), quantity);
  if (BigInt(chainId) !== 1n) throw new Error("source-chain-mismatch");

  const { finalizedBeaconRoot, blockNumber, blockHash, stateRoot } =
    await finalizedAnchor(source);

  const finalized = object(await rpc(source, "eth_getBlockByNumber", ["finalized", false]));
  const finalizedNumber = hex(finalized["number"], quantity);
  if (BigInt(blockNumber) > BigInt(finalizedNumber)) throw new Error("proof-not-finalized");
  const selected = object(await rpc(source, "eth_getBlockByNumber", [blockNumber, false]));
  if (hex(selected["number"], quantity) !== blockNumber
    || hex(selected["hash"], word) !== blockHash
    || hex(selected["stateRoot"], word) !== stateRoot) throw new Error("proof-block-mismatch");
  const header = await buildEthereumSourceHeader(selected, finalizedBeaconRoot);

  const result = object(await rpc(source, "eth_getProof", [vault, [slot], { blockHash, requireCanonical: true }]));
  if (hex(result["address"], address) !== vault) throw new Error("proof-account-mismatch");
  const codeHash = hex(result["codeHash"], word);
  if (codeHash !== expectedCodeHash) throw new Error("proof-code-mismatch");
  const accountNodes = proofNodes(result["accountProof"]);
  const storageProofs = result["storageProof"];
  if (!Array.isArray(storageProofs) || storageProofs.length !== 1) throw new Error("proof-invalid");
  const storage = object(storageProofs[0]);
  const key = hex(storage["key"], /^0x[0-9a-fA-F]{1,64}$/);
  const value = hex(storage["value"], quantity);
  if (BigInt(key) !== BigInt(slot) || BigInt(value) !== BigInt(commitment)) throw new Error("proof-commitment-mismatch");
  const storageNodes = proofNodes(storage["proof"]);
  const proof = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes[]" }, { type: "bytes[]" }],
    [lockId, accountNodes, storageNodes],
  );
  if ((proof.length - 2) / 2 > 96_000) throw new Error("proof-invalid");
  return { header, proof, blockNumber, blockHash, stateRoot, slot, codeHash };
}
