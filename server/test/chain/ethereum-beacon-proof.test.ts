import { createHash } from "node:crypto";
import { bls12_381 } from "@noble/curves/bls12-381";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Hex } from "viem";
import { monadClient } from "../../src/chain/monad.client.js";
import {
  beaconHeaderRoot, fetchBeaconBootstrap, fetchBeaconFinalityUpdate, fetchBeaconUpdate,
  fetchFinalizedBeaconBlock,
  prepareBeaconBootstrap, prepareBeaconUpdate, prepareFinalizedBeaconBlock,
  syncCommitteeRoot, verifySszBranch, type BeaconHeader,
} from "../../src/chain/ethereum-beacon-proof.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

const zero = `0x${"00".repeat(32)}` as Hex;
const fuluSlot = 411_392n * 32n;
const word = (byte: string) => `0x${byte.repeat(32)}` as Hex;
const sha = (value: Hex) => `0x${createHash("sha256")
  .update(Buffer.from(value.slice(2), "hex")).digest("hex")}` as Hex;
const pair = (left: Hex, right: Hex) => sha(`0x${left.slice(2)}${right.slice(2)}`);

function branchRoot(leaf: Hex, branch: Hex[], gindex: bigint): Hex {
  let root = leaf;
  for (const sibling of branch) {
    root = gindex % 2n === 0n ? pair(root, sibling) : pair(sibling, root);
    gindex >>= 1n;
  }
  expect(gindex).toBe(1n);
  return root;
}

const headerJson = (header: BeaconHeader) => ({
  slot: header.slot.toString(), proposer_index: header.proposerIndex.toString(),
  parent_root: header.parentRoot, state_root: header.stateRoot, body_root: header.bodyRoot,
});

function updateFixture() {
  const executionBlockHash = word("ab");
  const executionBranch = Array<Hex>(9).fill(zero);
  const finalized: BeaconHeader = {
    slot: fuluSlot + 32n, proposerIndex: 2n, parentRoot: word("11"), stateRoot: word("22"),
    bodyRoot: branchRoot(executionBlockHash, executionBranch, 812n),
  };
  const finalityBranch = Array<Hex>(7).fill(zero);
  const attested: BeaconHeader = {
    slot: finalized.slot + 1n, proposerIndex: 3n, parentRoot: word("33"),
    stateRoot: branchRoot(beaconHeaderRoot(finalized), finalityBranch, 169n), bodyRoot: word("44"),
  };
  const bits = `0x${"ff".repeat(42)}3f${"00".repeat(21)}`;
  const response = {
    version: "fulu", data: {
      attested_header: { beacon: headerJson(attested) },
      finalized_header: {
        beacon: headerJson(finalized), execution: { block_hash: executionBlockHash },
        execution_branch: executionBranch,
      },
      finality_branch: finalityBranch,
      sync_aggregate: {
        sync_committee_bits: bits, sync_committee_signature: `0x${"55".repeat(96)}`,
      },
      signature_slot: (attested.slot + 1n).toString(),
    },
  };
  const witness = {
    compressedPubkeys: `0x${"66".repeat(512 * 48)}`,
    aggregatePubkey: `0x${"77".repeat(48)}`,
    uncompressedParticipants: `0x${"88".repeat(342 * 128)}`,
    signature: `0x${"99".repeat(256)}`,
  };
  return { response, witness, attested, finalized, executionBlockHash };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("Ethereum Beacon proof preparation", () => {
  it("checks the trusted bootstrap root and committee branch for deployment", async () => {
    const pubkey = `0x${"12".repeat(48)}` as Hex;
    const aggregate = `0x${"34".repeat(48)}` as Hex;
    const pubkeys = Array<Hex>(512).fill(pubkey);
    const committeeRoot = syncCommitteeRoot(pubkeys, aggregate);
    const branch = Array<Hex>(6).fill(zero);
    const header: BeaconHeader = {
      slot: fuluSlot + 64n, proposerIndex: 2n, parentRoot: word("11"),
      stateRoot: branchRoot(committeeRoot, branch, 86n), bodyRoot: word("22"),
    };
    const trustedRoot = beaconHeaderRoot(header);
    const response = { version: "fulu", data: {
      header: { beacon: headerJson(header) },
      current_sync_committee: { pubkeys, aggregate_pubkey: aggregate },
      current_sync_committee_branch: branch,
    } };
    const checkpoint = prepareBeaconBootstrap(response, trustedRoot);
    expect(checkpoint.beaconRoot).toBe(trustedRoot);
    expect(checkpoint.currentCommitteeRoot).toBe(committeeRoot);
    expect(checkpoint.header.slot).toBe(header.slot.toString());
    expect(() => prepareBeaconBootstrap(response, word("ff"))).toThrow("beacon-proof-invalid");
    const fetchMock = vi.fn(async (_url: URL) => new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchBeaconBootstrap({ beaconApiUrl: "https://beacon.example", trustedRoot }))
      .toEqual(checkpoint);
    expect(new URL(fetchMock.mock.calls[0]![0] as URL).pathname)
      .toBe(`/eth/v1/beacon/light_client/bootstrap/${trustedRoot}`);
  });

  it("packages a finality-only update with verified SSZ branches", () => {
    const fixture = updateFixture();
    const prepared = prepareBeaconUpdate(fixture.response, fixture.witness);
    expect(prepared.finalizedBeaconRoot).toBe(beaconHeaderRoot(fixture.finalized));
    expect(prepared.executionBlockHash).toBe(fixture.executionBlockHash);
    expect(prepared.nextCommitteeRoot).toBe(zero);
    expect(prepared.calldata.slice(0, 10)).not.toBe("0x00000000");

    fixture.response.data.finality_branch[0] = word("ff");
    expect(() => prepareBeaconUpdate(fixture.response, fixture.witness)).toThrow("beacon-proof-invalid");
  });

  it("rejects malformed BLS witness lengths and unsupported fork data", () => {
    const fixture = updateFixture();
    expect(() => prepareBeaconUpdate(fixture.response, {
      ...fixture.witness, uncompressedParticipants: "0x11",
    })).toThrow("beacon-proof-invalid");
    expect(() => prepareBeaconUpdate({ ...fixture.response, version: "gloas" }, fixture.witness))
      .toThrow("beacon-proof-unsupported");
  });

  it("reads the standard updates array and rejects a wrapped array", async () => {
    const fixture = updateFixture();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([fixture.response])))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture.witness)));
    vi.stubGlobal("fetch", fetchMock);
    const prepared = await fetchBeaconUpdate({
      beaconApiUrl: "https://beacon.example", witnessUrl: "https://proof.example/witness",
      startPeriod: 1n,
    });
    expect(prepared.finalizedBeaconRoot).toBe(beaconHeaderRoot(fixture.finalized));
    expect(new URL(fetchMock.mock.calls[0]![0] as URL).pathname)
      .toBe("/eth/v1/beacon/light_client/updates");
    const witnessUrl = new URL(fetchMock.mock.calls[1]![0] as URL);
    expect(witnessUrl.searchParams.get("attested_root")).toBe(beaconHeaderRoot(fixture.attested));
    expect(witnessUrl.searchParams.get("signature_slot")).toBe((fixture.attested.slot + 1n).toString());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [fixture.response] }))));
    await expect(fetchBeaconUpdate({
      beaconApiUrl: "https://beacon.example", witnessUrl: "https://proof.example/witness",
      startPeriod: 1n,
    })).rejects.toThrow("beacon-proof-unavailable");
  });

  it("reads the standard finality update object", async () => {
    const fixture = updateFixture();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture.response)))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture.witness)));
    vi.stubGlobal("fetch", fetchMock);
    const prepared = await fetchBeaconFinalityUpdate({
      beaconApiUrl: "https://beacon.example", witnessUrl: "https://proof.example/witness",
    });
    expect(prepared.finalizedBeaconRoot).toBe(beaconHeaderRoot(fixture.finalized));
    expect(new URL(fetchMock.mock.calls[0]![0] as URL).pathname)
      .toBe("/eth/v1/beacon/light_client/finality_update");
  });

  it("builds the finality witness from a verified Beacon bootstrap", async () => {
    const fixture = updateFixture();
    const key = `0x${Buffer.from(bls12_381.G1.ProjectivePoint.BASE.toRawBytes(true)).toString("hex")}` as Hex;
    const signature = `0x${Buffer.from(bls12_381.G2.ProjectivePoint.BASE.toRawBytes(true)).toString("hex")}` as Hex;
    const pubkeys = Array<Hex>(512).fill(key);
    const committeeRoot = syncCommitteeRoot(pubkeys, key);
    const committeeBranch = Array<Hex>(6).fill(zero);
    fixture.finalized.stateRoot = branchRoot(committeeRoot, committeeBranch, 86n);
    fixture.response.data.finalized_header.beacon = headerJson(fixture.finalized);
    fixture.attested.stateRoot = branchRoot(beaconHeaderRoot(fixture.finalized),
      fixture.response.data.finality_branch, 169n);
    fixture.response.data.attested_header.beacon = headerJson(fixture.attested);
    fixture.response.data.sync_aggregate.sync_committee_signature = signature;
    const bootstrap = { version: "fulu", data: {
      header: { beacon: headerJson(fixture.finalized) },
      current_sync_committee: { pubkeys, aggregate_pubkey: key },
      current_sync_committee_branch: committeeBranch,
    } };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture.response)))
      .mockResolvedValueOnce(new Response(JSON.stringify(bootstrap)));
    vi.stubGlobal("fetch", fetchMock);
    const prepared = await fetchBeaconFinalityUpdate({
      beaconApiUrl: "https://beacon.example",
      signerRoots: { storedPeriod: fixture.finalized.slot / 8192n,
        currentRoot: committeeRoot, nextRoot: zero },
    });
    expect(prepared.signerCommitteeRoot).toBe(committeeRoot);
    expect(new URL(fetchMock.mock.calls[1]![0] as URL).pathname)
      .toBe(`/eth/v1/beacon/light_client/bootstrap/${beaconHeaderRoot(fixture.finalized)}`);
  });

  it("checks historical block_roots and execution branches before encoding", async () => {
    const executionBlockHash = word("aa");
    const executionBranch = Array<Hex>(9).fill(zero);
    const beacon: BeaconHeader = {
      slot: fuluSlot + 64n, proposerIndex: 4n, parentRoot: word("11"),
      stateRoot: word("22"), bodyRoot: branchRoot(executionBlockHash, executionBranch, 812n),
    };
    const blockRootBranch = Array<Hex>(19).fill(zero);
    const checkpointSlot = beacon.slot + 32n;
    const checkpointStateRoot = branchRoot(beaconHeaderRoot(beacon), blockRootBranch,
      69n * 8192n + beacon.slot % 8192n);
    const input = { checkpointRoot: word("cc"), checkpointStateRoot, checkpointSlot,
      beacon, blockRootBranch, executionBlockHash, executionBranch };
    const prepared = prepareFinalizedBeaconBlock(input);
    expect(prepared.beaconRoot).toBe(beaconHeaderRoot(beacon));
    expect(prepared.executionBlockHash).toBe(executionBlockHash);
    expect(() => prepareFinalizedBeaconBlock({ ...input, executionBlockHash: word("dd") }))
      .toThrow("beacon-proof-invalid");
    expect(() => prepareFinalizedBeaconBlock({ ...input, checkpointSlot: beacon.slot + 8193n }))
      .toThrow("beacon-proof-invalid");
    const readContract = vi.fn(async () => [checkpointStateRoot, checkpointSlot]);
    vi.mocked(monadClient).mockReturnValue({ readContract } as never);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        root: beaconHeaderRoot(beacon), header: { message: headerJson(beacon) },
      } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        checkpoint_root: input.checkpointRoot, target_slot: beacon.slot.toString(),
        block_root_branch: blockRootBranch, execution_block_hash: executionBlockHash,
        execution_branch: executionBranch,
      })));
    vi.stubGlobal("fetch", fetchMock);
    const fetched = await fetchFinalizedBeaconBlock({ beaconApiUrl: "https://beacon.example",
      proofUrl: "https://proof.example/branch", beaconClient: `0x${"11".repeat(20)}`,
      checkpointRoot: input.checkpointRoot, targetSlot: beacon.slot });
    expect(fetched).toEqual(prepared);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "finalizedCheckpoints", args: [input.checkpointRoot],
    }));
  });

  it("uses the SSZ 48-byte pubkey chunks for the sync committee root", () => {
    const pubkeys = Array<Hex>(512).fill(`0x${"12".repeat(48)}`);
    const aggregate = `0x${"34".repeat(48)}` as Hex;
    const root = syncCommitteeRoot(pubkeys, aggregate);
    const leaf = sha(`0x${"12".repeat(48)}${"00".repeat(16)}`);
    let vectorRoot = leaf;
    for (let i = 0; i < 9; i += 1) vectorRoot = pair(vectorRoot, vectorRoot);
    expect(root).toBe(pair(vectorRoot, sha(`0x${"34".repeat(48)}${"00".repeat(16)}`)));
    expect(verifySszBranch(leaf, [zero], 2n, pair(leaf, zero))).toBe(true);
    expect(verifySszBranch(leaf, [zero], 3n, pair(leaf, zero))).toBe(false);
  });
});
