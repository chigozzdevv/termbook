import { describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { keccak256 } from "viem";
import { solanaPubkeyBase58 } from "@termbook/sdk";
import { verifySolanaRelayProgram } from "../../src/collateral/solana-relay.program.js";

const hex = (byte: string) => `0x${byte.repeat(64)}` as const;
const program = hex("1"), genesis = hex("2"), dataKey = hex("3");
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
function fixture() {
  const programData = Buffer.alloc(36); programData.writeUInt32LE(2); programData.set(Buffer.from(dataKey.slice(2), "hex"), 4);
  const state = Buffer.alloc(48); state.writeUInt32LE(3); state.set([1, 2, 3], 45);
  const getAccountInfo = vi.fn(async (key: PublicKey) => key.toBase58() === solanaPubkeyBase58(program)
    ? { executable: true, owner: loader, data: programData } : { executable: false, owner: loader, data: state });
  const connection = { getGenesisHash: async () => solanaPubkeyBase58(genesis), getAccountInfo } as unknown as Connection;
  return { connection, state };
}
describe("source program identity", () => {
  it("accepts only the pinned finalized binary with extinguished upgrade authority", async () => {
    const f = fixture();
    await verifySolanaRelayProgram(f.connection, program, genesis, keccak256(new Uint8Array([1, 2, 3])));
    f.state[12] = 1;
    await expect(verifySolanaRelayProgram(f.connection, program, genesis, keccak256(new Uint8Array([1, 2, 3]))))
      .rejects.toThrow("solana-relay-program-mutable");
  });
  it("rejects substituted networks and program binaries", async () => {
    const f = fixture();
    await expect(verifySolanaRelayProgram(f.connection, program, hex("4"), hex("5"))).rejects.toThrow("solana-relay-genesis-mismatch");
    await expect(verifySolanaRelayProgram(f.connection, program, genesis, hex("5"))).rejects.toThrow("solana-relay-program-hash-mismatch");
  });
});
