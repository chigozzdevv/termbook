import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSolanaProof, solanaBase58Bytes } from "../../src/collateral/solana-proof.js";
import { hexToBytes, keccak256, stringToHex } from "viem";

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
    let vaa: string | number[] = Array.from(raw);
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
      proofUrl: "https://scan.example", kind: "lock", digest: id("2"),
      genesis, programId: id("3"), programDataHash: id("5"), lockPda: account, sourceTx: tx });
    expect(proof).toMatchObject({ header: `0x${Buffer.from(raw).toString("hex")}`,
      slot: 90, blockhash });
    raw[body + 50] = 0;
    vaa = Buffer.from(raw).toString("base64");
    await expect(fetchSolanaProof({ rpcUrl: "https://rpc.example",
      proofUrl: "https://scan.example", kind: "lock", digest: id("2"),
      genesis, programId: id("3"), programDataHash: id("5"), lockPda: account,
      sourceTx: tx })).rejects.toThrow("solana-proof-unavailable");
  });

  it("rejects an invalid source transaction signature", async () => {
    await expect(fetchSolanaProof({ rpcUrl: "https://rpc.example", proofUrl: "https://scan.example",
      kind: "lock", digest: id("2"), genesis: id("3"), programId: id("4"),
      programDataHash: id("5"), lockPda: id("6"), sourceTx: "invalid" }))
      .rejects.toThrow();
  });
});
