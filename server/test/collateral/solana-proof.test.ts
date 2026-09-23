import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSolanaProof, solanaBase58Bytes } from "../../src/collateral/solana-proof.js";

const id = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const blockhash = "So11111111111111111111111111111111111111112";

afterEach(() => vi.unstubAllGlobals());

describe("Solana finalized proof producer", () => {
  it("requires the exact digest and a matching finalized Solana block", async () => {
    const genesis = solanaBase58Bytes(blockhash);
    const input = {
      rpcUrl: "https://rpc.example", proofUrl: "https://proof.example",
      kind: "lock" as const, id: id("1"), digest: id("2"),
      genesis, programId: id("3"), programDataHash: id("5"), lockPda: id("4"),
    };
    let finalized = 90;
    let reportedDigest = input.digest;
    let reportedProgramHash = input.programDataHash;
    let activeKind = "lock";
    let accountPda = id("7");
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === "POST") {
        const body = JSON.parse(init.body as string) as { method: string };
        const result = body.method === "getGenesisHash" ? blockhash
          : body.method === "getSlot" ? finalized
            : { blockhash };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      }
      expect(url.toString()).toBe(`https://proof.example/${activeKind}/${input.id}`);
      return new Response(JSON.stringify({
        header: "0xaa", proof: "0xbb", digest: reportedDigest,
        sourceGenesis: genesis, programId: input.programId,
        programDataHash: reportedProgramHash, lockPda: input.lockPda, accountPda,
        slot: 80, blockhash,
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSolanaProof(input)).toMatchObject({ header: "0xaa", proof: "0xbb", slot: 80, blockhash });
    reportedDigest = id("5");
    await expect(fetchSolanaProof(input)).rejects.toThrow("solana-proof-invalid");
    reportedDigest = input.digest;
    reportedProgramHash = id("6");
    await expect(fetchSolanaProof(input)).rejects.toThrow("solana-proof-invalid");
    reportedProgramHash = input.programDataHash;
    finalized = 79;
    await expect(fetchSolanaProof(input)).rejects.toThrow("solana-proof-not-finalized");
    finalized = 90;
    activeKind = "recovery";
    const recovery = { ...input, kind: "recovery" as const, accountPda: id("7") };
    expect(await fetchSolanaProof(recovery)).toMatchObject({ header: "0xaa", proof: "0xbb" });
    accountPda = id("8");
    await expect(fetchSolanaProof(recovery)).rejects.toThrow("solana-proof-invalid");
  });
});
