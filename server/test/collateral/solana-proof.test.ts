import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSolanaProof, solanaBase58Bytes } from "../../src/collateral/solana-proof.js";
import { encodeAbiParameters, hexToBytes, keccak256, stringToHex } from "viem";

const id = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const blockhash = "So11111111111111111111111111111111111111112";

afterEach(() => vi.unstubAllGlobals());

describe("Solana Wormhole proof producer", () => {
  it("finds the signed snapshot by a finalized Solana transaction", async () => {
    const account = id("4");
    const raw = new Uint8Array(6 + 66 + 51 + 76 + 2);
    raw[0] = 1;
    raw[5] = 1;
    const body = 72;
    const view = new DataView(raw.buffer);
    view.setUint16(body + 8, 1, false);
    raw[body + 50] = 1;
    raw.set(hexToBytes(keccak256(stringToHex("Termbook Solana snapshot v1"))), body + 51);
    raw.set(hexToBytes(account), body + 83);
    view.setUint32(body + 123, 2, true);
    raw.set([1, 2], body + 127);
    let vaa = Buffer.from(raw).toString("base64");
    const tx = "2".repeat(88);
    const genesis = solanaBase58Bytes(blockhash);
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === "POST") {
        const request = JSON.parse(init.body as string) as { method: string };
        const result = request.method === "getGenesisHash" ? blockhash
          : request.method === "getTransaction" ? { slot: 90, meta: { err: null } }
            : { blockhash };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      }
      expect(url.toString()).toBe(`https://scan.example/api/v1/vaas?txHash=${tx}&pageSize=100`);
      return new Response(JSON.stringify({ data: [{ emitterChain: 1, vaa }] }), { status: 200 });
    }));
    const proof = await fetchSolanaProof({ rpcUrl: "https://rpc.example",
      proofUrl: "https://scan.example", kind: "lock", id: id("1"), digest: id("2"),
      genesis, programId: id("3"), programDataHash: id("5"), lockPda: account, sourceTx: tx });
    expect(proof).toMatchObject({ header: `0x${Buffer.from(raw).toString("hex")}`,
      slot: 90, blockhash });
    raw[body + 50] = 0;
    vaa = Buffer.from(raw).toString("base64");
    await expect(fetchSolanaProof({ rpcUrl: "https://rpc.example",
      proofUrl: "https://scan.example", kind: "lock", id: id("1"), digest: id("2"),
      genesis, programId: id("3"), programDataHash: id("5"), lockPda: account,
      sourceTx: tx })).rejects.toThrow("solana-proof-unavailable");
  });

  it("wraps a signed VAA for the exact account and rejects mismatched metadata", async () => {
    const genesis = solanaBase58Bytes(blockhash);
    const input = {
      rpcUrl: "https://rpc.example", proofUrl: "https://proof.example",
      kind: "lock" as const, id: id("1"), digest: id("2"),
      genesis, programId: id("3"), programDataHash: id("5"), lockPda: id("4"),
    };
    let reportedDigest = input.digest;
    let reportedProgramHash = input.programDataHash;
    let activeKind = "lock";
    let accountPda = id("7");
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === "POST") {
        const body = JSON.parse(init.body as string) as { method: string };
        const result = body.method === "getGenesisHash" ? blockhash : 90;
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      }
      expect(url.toString()).toBe(`https://proof.example/${activeKind}/${input.id}`);
      return new Response(JSON.stringify({
        vaa: "0xaa", digest: reportedDigest,
        sourceGenesis: genesis, programId: input.programId,
        programDataHash: reportedProgramHash, lockPda: input.lockPda, accountPda,
        slot: 80, blockhash,
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const lockProof = encodeAbiParameters([
      { type: "bytes32" }, { type: "bytes" }, { type: "bytes" },
    ], [input.lockPda, "0x01", "0x02"]);
    expect(await fetchSolanaProof(input)).toMatchObject({ header: "0xaa", proof: lockProof, slot: 80, blockhash });
    reportedDigest = id("5");
    await expect(fetchSolanaProof(input)).rejects.toThrow("solana-proof-invalid");
    reportedDigest = input.digest;
    reportedProgramHash = id("6");
    await expect(fetchSolanaProof(input)).rejects.toThrow("solana-proof-invalid");
    reportedProgramHash = input.programDataHash;
    reportedProgramHash = input.programDataHash;
    activeKind = "recovery";
    const recovery = { ...input, kind: "recovery" as const, accountPda: id("7") };
    const recoveryProof = encodeAbiParameters([
      { type: "bytes32" }, { type: "bytes" }, { type: "bytes" },
    ], [id("7"), "0x01", "0x02"]);
    expect(await fetchSolanaProof(recovery)).toMatchObject({ header: "0xaa", proof: recoveryProof });
    accountPda = id("8");
    await expect(fetchSolanaProof(recovery)).rejects.toThrow("solana-proof-invalid");
  });
});
