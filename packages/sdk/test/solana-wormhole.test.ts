import { afterEach, describe, expect, it, vi } from "vitest";
import { hexToBytes, keccak256, stringToHex } from "viem";
import { deserialize } from "@wormhole-foundation/sdk-connect";
import { fetchMonadAuthorizationVaa, submitSolanaLockCheckpoint } from "../src/collateral/solana-wormhole.js";
import { solanaPubkeyBase58 } from "../src/collateral/solana.js";
import { wormholeFixture } from "./solana-wormhole.fixture.js";

afterEach(() => vi.unstubAllGlobals());

describe("Monad Wormhole authorization lookup", () => {
  it("emits a fresh lock snapshot for a delayed proof", async () => {
    const programId = solanaPubkeyBase58(`0x${"11".repeat(32)}`);
    const lockPda = solanaPubkeyBase58(`0x${"22".repeat(32)}`);
    const payer = solanaPubkeyBase58(`0x${"33".repeat(32)}`);
    const fixture = wormholeFixture(payer, `0x${"44".repeat(20)}`, `0x${"55".repeat(32)}`);
    const sendInstruction = vi.fn(async () => "2".repeat(88));
    await expect(submitSolanaLockCheckpoint({ publicKey: payer, sendInstruction,
      prepareWormholeSnapshot: async () => fixture.snapshotAccounts }, programId, lockPda))
      .resolves.toBe("2".repeat(88));
    expect(sendInstruction).toHaveBeenCalledWith({ programId,
      keys: [{ pubkey: lockPda, isSigner: false, isWritable: false }, ...fixture.snapshotAccounts],
      data: new Uint8Array([7]) });
  });

  it("selects only the exact Core authorization from a signed transaction", async () => {
    const core = `0x${"12".repeat(20)}` as `0x${string}`;
    const action = `0x${"34".repeat(32)}` as `0x${string}`;
    const tx = `0x${"56".repeat(32)}` as `0x${string}`;
    const raw = new Uint8Array(6 + 66 + 51 + 64);
    raw[0] = 1;
    raw[5] = 1;
    const body = 72;
    new DataView(raw.buffer).setUint16(body + 8, 48, false);
    raw.set(hexToBytes(core), body + 22);
    raw.set(hexToBytes(keccak256(stringToHex("Termbook Monad authorization v1"))), body + 51);
    raw.set(hexToBytes(action), body + 83);
    const signed = btoa(String.fromCharCode(...raw));
    expect(deserialize("Uint8Array", raw).emitterChain).toBe("Monad");
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      expect(url.toString()).toBe(`https://scan.example/api/v1/vaas?txHash=${tx}&pageSize=100`);
      return new Response(JSON.stringify({ data: [{ emitterChain: 48, vaa: signed }] }));
    }));
    expect(await fetchMonadAuthorizationVaa("https://scan.example", tx, core, action)).toEqual(raw);
    await expect(fetchMonadAuthorizationVaa("https://scan.example", tx, core,
      `0x${"78".repeat(32)}`)).rejects.toThrow("solana-wormhole-authorization-unavailable");
  });
});
