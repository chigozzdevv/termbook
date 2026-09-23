import { createHash } from "node:crypto";
import { concatHex, encodeFunctionData, type Address, type Hex } from "viem";
import { monadClient } from "./monad.client.js";
import { buildBeaconWitness } from "./ethereum-beacon-witness.js";

const wordPattern = /^0x[0-9a-fA-F]{64}$/;
const hexPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/;
const zeroWord = `0x${"00".repeat(32)}` as Hex;
const maxUint64 = (1n << 64n) - 1n;
const fuluStartSlot = 411_392n * 32n;

const headerComponents = [
  { name: "slot", type: "uint64" }, { name: "proposerIndex", type: "uint64" },
  { name: "parentRoot", type: "bytes32" }, { name: "stateRoot", type: "bytes32" },
  { name: "bodyRoot", type: "bytes32" },
] as const;
const beaconAbi = [
  { name: "submitUpdate", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "update", type: "tuple", components: [
      { name: "attested", type: "tuple", components: headerComponents },
      { name: "finalized", type: "tuple", components: headerComponents },
      { name: "finalityBranch", type: "bytes32[]" },
      { name: "executionBlockHash", type: "bytes32" },
      { name: "executionBranch", type: "bytes32[]" },
      { name: "nextCommitteeRoot", type: "bytes32" },
      { name: "nextCommitteeBranch", type: "bytes32[]" },
      { name: "syncCommitteeBits", type: "bytes" },
      { name: "signature", type: "bytes" },
      { name: "signatureSlot", type: "uint64" },
    ] },
    { name: "witness", type: "tuple", components: [
      { name: "compressedPubkeys", type: "bytes" },
      { name: "aggregatePubkey", type: "bytes" },
      { name: "uncompressedParticipants", type: "bytes" },
    ] },
  ], outputs: [] },
  { name: "submitFinalizedBlock", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "checkpointRoot", type: "bytes32" },
    { name: "beacon", type: "tuple", components: headerComponents },
    { name: "blockRootBranch", type: "bytes32[]" },
    { name: "executionBlockHash", type: "bytes32" },
    { name: "executionBranch", type: "bytes32[]" },
  ], outputs: [] },
  { name: "finalizedCheckpoints", type: "function", stateMutability: "view",
    inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes32" }, { type: "uint64" }] },
] as const;

export type BeaconHeader = {
  slot: bigint;
  proposerIndex: bigint;
  parentRoot: Hex;
  stateRoot: Hex;
  bodyRoot: Hex;
};

export type CommitteeWitness = {
  compressedPubkeys: Hex;
  aggregatePubkey: Hex;
  uncompressedParticipants: Hex;
  signature: Hex;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("beacon-proof-invalid");
  return value as Record<string, unknown>;
}

function word(value: unknown): Hex {
  if (typeof value !== "string" || !wordPattern.test(value)) throw new Error("beacon-proof-invalid");
  return value.toLowerCase() as Hex;
}

function bytes(value: unknown, length: number): Hex {
  if (typeof value !== "string" || !hexPattern.test(value) || (value.length - 2) / 2 !== length) {
    throw new Error("beacon-proof-invalid");
  }
  return value.toLowerCase() as Hex;
}

function decimal(value: unknown): bigint {
  if (typeof value !== "string" || !decimalPattern.test(value)) throw new Error("beacon-proof-invalid");
  const parsed = BigInt(value);
  if (parsed > maxUint64) throw new Error("beacon-proof-invalid");
  return parsed;
}

function words(value: unknown, count: number): Hex[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error("beacon-proof-invalid");
  return value.map(word);
}

function sha(value: Hex): Hex {
  return `0x${createHash("sha256").update(Buffer.from(value.slice(2), "hex")).digest("hex")}` as Hex;
}

function digest(left: Hex, right: Hex): Hex {
  return sha(concatHex([left, right]));
}

function uint64Root(value: bigint): Hex {
  const root = Buffer.alloc(32);
  root.writeBigUInt64LE(value);
  return `0x${root.toString("hex")}` as Hex;
}

export function beaconHeaderRoot(header: BeaconHeader): Hex {
  return digest(
    digest(digest(uint64Root(header.slot), uint64Root(header.proposerIndex)),
      digest(header.parentRoot, header.stateRoot)),
    digest(digest(header.bodyRoot, zeroWord), digest(zeroWord, zeroWord)),
  );
}

export function verifySszBranch(leaf: Hex, branch: readonly Hex[], generalizedIndex: bigint, root: Hex): boolean {
  let index = generalizedIndex;
  let value = leaf;
  for (const sibling of branch) {
    if (index < 2n) return false;
    value = index % 2n === 0n ? digest(value, sibling) : digest(sibling, value);
    index >>= 1n;
  }
  return index === 1n && value === root;
}

export function syncCommitteeRoot(pubkeys: readonly Hex[], aggregatePubkey: Hex): Hex {
  if (pubkeys.length !== 512 || !/^0x[0-9a-f]{96}$/.test(aggregatePubkey)) {
    throw new Error("beacon-proof-invalid");
  }
  let level = pubkeys.map((key) => sha(`${bytes(key, 48)}${"00".repeat(16)}` as Hex));
  for (let width = 512; width > 1; width >>= 1) {
    const next: Hex[] = [];
    for (let i = 0; i < width; i += 2) next.push(digest(level[i]!, level[i + 1]!));
    level = next;
  }
  return digest(level[0]!, sha(`${aggregatePubkey}${"00".repeat(16)}` as Hex));
}

function parseHeader(value: unknown): BeaconHeader {
  const header = record(value);
  return {
    slot: decimal(header["slot"]),
    proposerIndex: decimal(header["proposer_index"]),
    parentRoot: word(header["parent_root"]),
    stateRoot: word(header["state_root"]),
    bodyRoot: word(header["body_root"]),
  };
}

function parseWitness(value: unknown, participants: number): CommitteeWitness {
  const witness = record(value);
  const compressedPubkeys = bytes(witness["compressedPubkeys"], 512 * 48);
  const aggregatePubkey = bytes(witness["aggregatePubkey"], 48);
  const uncompressedParticipants = bytes(witness["uncompressedParticipants"], participants * 128);
  const signature = bytes(witness["signature"], 256);
  if (signature === `0x${"00".repeat(256)}`) throw new Error("beacon-proof-invalid");
  return { compressedPubkeys, aggregatePubkey, uncompressedParticipants, signature };
}

function participantCount(bits: Hex): number {
  let count = 0;
  for (let i = 2; i < bits.length; i += 2) {
    let value = Number.parseInt(bits.slice(i, i + 2), 16);
    while (value) {
      value &= value - 1;
      count += 1;
    }
  }
  return count;
}

export function prepareBeaconBootstrap(response: unknown, trustedRoot: Hex) {
  const trusted = word(trustedRoot);
  const envelope = record(response);
  if (String(envelope["version"]).toLowerCase() !== "fulu") throw new Error("beacon-proof-unsupported");
  const data = record(envelope["data"]);
  const header = parseHeader(record(data["header"])["beacon"]);
  const committee = record(data["current_sync_committee"]);
  const pubkeys = wordsOfBytes(committee["pubkeys"], 512, 48);
  const aggregate = bytes(committee["aggregate_pubkey"], 48);
  const currentCommitteeRoot = syncCommitteeRoot(pubkeys, aggregate);
  const currentCommitteeBranch = words(data["current_sync_committee_branch"], 6);
  if (header.slot < fuluStartSlot || trusted === zeroWord
    || beaconHeaderRoot(header) !== trusted
    || !verifySszBranch(currentCommitteeRoot, currentCommitteeBranch, 86n, header.stateRoot)) {
    throw new Error("beacon-proof-invalid");
  }
  return {
    beaconRoot: trusted,
    header: {
      slot: header.slot.toString(), proposerIndex: header.proposerIndex.toString(),
      parentRoot: header.parentRoot, stateRoot: header.stateRoot, bodyRoot: header.bodyRoot,
    },
    currentCommitteeRoot,
    currentCommitteeBranch,
  };
}

export function prepareBeaconUpdate(response: unknown, witnessInput: unknown) {
  const envelope = record(response);
  if (String(envelope["version"]).toLowerCase() !== "fulu") throw new Error("beacon-proof-unsupported");
  const data = record(envelope["data"]);
  const attested = parseHeader(record(data["attested_header"])["beacon"]);
  const finalizedHeader = record(data["finalized_header"]);
  const finalized = parseHeader(finalizedHeader["beacon"]);
  const executionBlockHash = word(record(finalizedHeader["execution"])["block_hash"]);
  const executionBranch = words(finalizedHeader["execution_branch"], 9);
  const finalityBranch = words(data["finality_branch"], 7);
  let nextCommitteeRoot = zeroWord;
  let nextCommitteeBranch: Hex[] = [];
  if (data["next_sync_committee"] != null || data["next_sync_committee_branch"] != null) {
    const nextCommittee = record(data["next_sync_committee"]);
    const pubkeys = wordsOfBytes(nextCommittee["pubkeys"], 512, 48);
    const aggregatePubkey = bytes(nextCommittee["aggregate_pubkey"], 48);
    nextCommitteeRoot = syncCommitteeRoot(pubkeys, aggregatePubkey);
    nextCommitteeBranch = words(data["next_sync_committee_branch"], 6);
  }
  const aggregate = record(data["sync_aggregate"]);
  const bits = bytes(aggregate["sync_committee_bits"], 64);
  const compressedSignature = bytes(aggregate["sync_committee_signature"], 96);
  const participants = participantCount(bits);
  const signatureSlot = decimal(data["signature_slot"]);
  if (attested.slot < fuluStartSlot || finalized.slot < fuluStartSlot || finalized.slot > attested.slot
    || signatureSlot <= attested.slot || participants < 342 || compressedSignature === `0x${"00".repeat(96)}`
    || executionBlockHash === zeroWord
    || !verifySszBranch(beaconHeaderRoot(finalized), finalityBranch, 169n, attested.stateRoot)
    || !verifySszBranch(executionBlockHash, executionBranch, 812n, finalized.bodyRoot)
    || (nextCommitteeRoot !== zeroWord
      && !verifySszBranch(nextCommitteeRoot, nextCommitteeBranch, 87n, attested.stateRoot))) {
    throw new Error("beacon-proof-invalid");
  }
  const witness = parseWitness(witnessInput, participants);
  const signerPubkeys = Array.from({ length: 512 }, (_, index) =>
    `0x${witness.compressedPubkeys.slice(2 + index * 96, 2 + (index + 1) * 96)}` as Hex);
  const signerCommitteeRoot = syncCommitteeRoot(signerPubkeys, witness.aggregatePubkey);
  const calldata = encodeFunctionData({ abi: beaconAbi, functionName: "submitUpdate", args: [
    { attested, finalized, finalityBranch, executionBlockHash, executionBranch,
      nextCommitteeRoot, nextCommitteeBranch, syncCommitteeBits: bits,
      signature: witness.signature, signatureSlot },
    { compressedPubkeys: witness.compressedPubkeys, aggregatePubkey: witness.aggregatePubkey,
      uncompressedParticipants: witness.uncompressedParticipants },
  ] });
  return { calldata, finalizedBeaconRoot: beaconHeaderRoot(finalized), executionBlockHash,
    finalizedSlot: finalized.slot, attestedSlot: attested.slot, nextCommitteeRoot,
    signerCommitteeRoot, signatureSlot };
}

function wordsOfBytes(value: unknown, count: number, length: number): Hex[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error("beacon-proof-invalid");
  return value.map((entry) => bytes(entry, length));
}

async function fetchJson(url: URL, maxChars: number): Promise<unknown> {
  if (!new Set(["https:", "http:"]).has(url.protocol)) throw new Error("beacon-proof-invalid");
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error",
    headers: { Accept: "application/json" } }).catch(() => null);
  if (!response?.ok) throw new Error("beacon-proof-unavailable");
  const body = await response.text();
  if (body.length > maxChars) throw new Error("beacon-proof-invalid");
  try { return JSON.parse(body) as unknown; } catch { throw new Error("beacon-proof-invalid"); }
}

function witnessEndpoint(base: string, update: unknown): URL {
  const data = record(record(update)["data"]);
  const attested = parseHeader(record(data["attested_header"])["beacon"]);
  const signatureSlot = decimal(data["signature_slot"]);
  const endpoint = new URL(base);
  endpoint.searchParams.set("attested_root", beaconHeaderRoot(attested));
  endpoint.searchParams.set("signature_slot", signatureSlot.toString());
  return endpoint;
}

type SignerRoots = { storedPeriod: bigint; currentRoot: Hex; nextRoot: Hex };

function committee(value: unknown) {
  const record_ = record(value);
  return {
    pubkeys: wordsOfBytes(record_["pubkeys"], 512, 48),
    aggregatePubkey: bytes(record_["aggregate_pubkey"], 48),
  };
}

function signerRoot(update: unknown, roots: SignerRoots): Hex {
  const data = record(record(update)["data"]);
  const period = decimal(data["signature_slot"]) / 8192n;
  if (period === roots.storedPeriod) return word(roots.currentRoot);
  if (period === roots.storedPeriod + 1n) return word(roots.nextRoot);
  throw new Error("beacon-witness-unavailable");
}

async function builtinWitness(beaconApiUrl: string, update: unknown, roots: SignerRoots) {
  const data = record(record(update)["data"]);
  const expectedRoot = signerRoot(update, roots);
  if (expectedRoot === zeroWord) throw new Error("beacon-witness-unavailable");
  const aggregate = record(data["sync_aggregate"]);
  const bits = bytes(aggregate["sync_committee_bits"], 64);
  const signature = bytes(aggregate["sync_committee_signature"], 96);
  const matched = (candidate: unknown) => {
    try {
      const parsed = committee(candidate);
      if (syncCommitteeRoot(parsed.pubkeys, parsed.aggregatePubkey) !== expectedRoot) return null;
      return buildBeaconWitness({ ...parsed, bits, signature });
    } catch { return null; }
  };
  const embedded = matched(data["next_sync_committee"]);
  if (embedded) return embedded;

  const finalized = parseHeader(record(record(data["finalized_header"])["beacon"]));
  const bootstrapUrl = new URL(beaconApiUrl);
  bootstrapUrl.pathname = `${bootstrapUrl.pathname.replace(/\/$/, "")}/eth/v1/beacon/light_client/bootstrap/${beaconHeaderRoot(finalized)}`;
  bootstrapUrl.search = "";
  try {
    const bootstrap = await fetchJson(bootstrapUrl, 100_000);
    prepareBeaconBootstrap(bootstrap, beaconHeaderRoot(finalized));
    const current = matched(record(record(bootstrap)["data"])["current_sync_committee"]);
    if (current) return current;
  } catch { /* Continue with a periodic update. */ }

  const period = decimal(data["signature_slot"]) / 8192n;
  if (period > 0n) {
    const endpoint = new URL(beaconApiUrl);
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/eth/v1/beacon/light_client/updates`;
    endpoint.search = new URLSearchParams({ start_period: (period - 1n).toString(), count: "1" }).toString();
    try {
      const updates = await fetchJson(endpoint, 500_000);
      if (Array.isArray(updates) && updates.length === 1) {
        const previous = matched(record(record(updates[0])["data"])["next_sync_committee"]);
        if (previous) return previous;
      }
    } catch { /* No matching signer committee was supplied. */ }
  }
  throw new Error("beacon-witness-unavailable");
}

export async function fetchBeaconUpdate(input: {
  beaconApiUrl: string; startPeriod: bigint; witnessUrl?: string; signerRoots?: SignerRoots;
}) {
  if (input.startPeriod < 0n || input.startPeriod > maxUint64) throw new Error("beacon-proof-invalid");
  const endpoint = new URL(input.beaconApiUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/eth/v1/beacon/light_client/updates`;
  endpoint.search = new URLSearchParams({ start_period: input.startPeriod.toString(), count: "1" }).toString();
  const updates = await fetchJson(endpoint, 500_000);
  if (!Array.isArray(updates) || updates.length !== 1) throw new Error("beacon-proof-unavailable");
  const witness = input.witnessUrl
    ? await fetchJson(witnessEndpoint(input.witnessUrl, updates[0]), 200_000)
    : await builtinWitness(input.beaconApiUrl, updates[0], input.signerRoots ?? invalidSignerRoots());
  return prepareBeaconUpdate(updates[0], witness);
}

function invalidSignerRoots(): never { throw new Error("beacon-witness-unavailable"); }

export async function fetchBeaconBootstrap(input: { beaconApiUrl: string; trustedRoot: Hex }) {
  const trustedRoot = word(input.trustedRoot);
  if (trustedRoot === zeroWord) throw new Error("beacon-proof-invalid");
  const endpoint = new URL(input.beaconApiUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/eth/v1/beacon/light_client/bootstrap/${trustedRoot}`;
  endpoint.search = "";
  return prepareBeaconBootstrap(await fetchJson(endpoint, 100_000), trustedRoot);
}

export async function fetchBeaconFinalityUpdate(input: {
  beaconApiUrl: string; witnessUrl?: string; signerRoots?: SignerRoots;
}) {
  const endpoint = new URL(input.beaconApiUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/eth/v1/beacon/light_client/finality_update`;
  endpoint.search = "";
  const update = await fetchJson(endpoint, 100_000);
  const witness = input.witnessUrl
    ? await fetchJson(witnessEndpoint(input.witnessUrl, update), 200_000)
    : await builtinWitness(input.beaconApiUrl, update, input.signerRoots ?? invalidSignerRoots());
  return prepareBeaconUpdate(update, witness);
}

export function prepareFinalizedBeaconBlock(input: {
  checkpointRoot: Hex; checkpointStateRoot: Hex; checkpointSlot: bigint;
  beacon: BeaconHeader; blockRootBranch: Hex[]; executionBlockHash: Hex; executionBranch: Hex[];
}) {
  const targetRoot = beaconHeaderRoot(input.beacon);
  const distance = input.checkpointSlot - input.beacon.slot;
  const gindex = 69n * 8192n + input.beacon.slot % 8192n;
  if (input.checkpointRoot === zeroWord || input.checkpointStateRoot === zeroWord
    || input.beacon.slot < fuluStartSlot || distance <= 0n || distance > 8192n
    || input.blockRootBranch.length !== 19 || input.executionBranch.length !== 9
    || !verifySszBranch(targetRoot, input.blockRootBranch, gindex, input.checkpointStateRoot)
    || !verifySszBranch(input.executionBlockHash, input.executionBranch, 812n, input.beacon.bodyRoot)) {
    throw new Error("beacon-proof-invalid");
  }
  const calldata = encodeFunctionData({ abi: beaconAbi, functionName: "submitFinalizedBlock",
    args: [input.checkpointRoot, input.beacon, input.blockRootBranch,
      input.executionBlockHash, input.executionBranch] });
  return { calldata, beaconRoot: targetRoot, executionBlockHash: input.executionBlockHash,
    slot: input.beacon.slot };
}

export async function fetchFinalizedBeaconBlock(input: {
  beaconApiUrl: string; proofUrl: string; beaconClient: Address;
  checkpointRoot: Hex; targetSlot: bigint;
}) {
  if (input.targetSlot < fuluStartSlot || input.targetSlot > maxUint64) throw new Error("beacon-proof-invalid");
  const [checkpointStateRoot, checkpointSlot] = await monadClient().readContract({
    address: input.beaconClient, abi: beaconAbi, functionName: "finalizedCheckpoints",
    args: [input.checkpointRoot],
  });
  if (checkpointStateRoot === zeroWord || checkpointSlot <= input.targetSlot
    || checkpointSlot - input.targetSlot > 8192n) throw new Error("beacon-proof-invalid");
  const endpoint = new URL(input.beaconApiUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/eth/v1/beacon/headers/${input.targetSlot}`;
  endpoint.search = "";
  const headerEnvelope = record(await fetchJson(endpoint, 10_000));
  const headerData = record(headerEnvelope["data"]);
  const beacon = parseHeader(record(record(headerData["header"])["message"]));
  if (beacon.slot !== input.targetSlot || word(headerData["root"]) !== beaconHeaderRoot(beacon)) {
    throw new Error("beacon-proof-invalid");
  }
  const branch = record(await fetchJson(new URL(input.proofUrl), 20_000));
  if (word(branch["checkpoint_root"]) !== input.checkpointRoot
    || decimal(branch["target_slot"]) !== input.targetSlot) throw new Error("beacon-proof-invalid");
  return prepareFinalizedBeaconBlock({ checkpointRoot: input.checkpointRoot,
    checkpointStateRoot, checkpointSlot, beacon,
    blockRootBranch: words(branch["block_root_branch"], 19),
    executionBlockHash: word(branch["execution_block_hash"]),
    executionBranch: words(branch["execution_branch"], 9) });
}
