import { PublicKey, type Connection } from "@solana/web3.js";
import { keccak256, type Hex } from "viem";
import { solanaPubkeyBase58, solanaPubkeyBytes, verifySolanaProgramAuthority } from "@termbook/sdk";

const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
export async function verifySolanaRelayProgram(connection: Connection, programId: Hex, genesis: Hex, expectedHash: Hex,
  testnetAuthority?: string): Promise<void> {
  if (solanaPubkeyBytes(await connection.getGenesisHash()) !== genesis) throw new Error("solana-relay-genesis-mismatch");
  const program = await connection.getAccountInfo(new PublicKey(solanaPubkeyBase58(programId)), "finalized");
  if (!program?.executable || program.owner.toBase58() !== loader || program.data.length !== 36
    || program.data.readUInt32LE(0) !== 2) throw new Error("solana-relay-program-invalid");
  const state = await connection.getAccountInfo(new PublicKey(program.data.subarray(4)), "finalized");
  if (!state || state.executable || state.owner.toBase58() !== loader || state.data.length <= 45
    || state.data.readUInt32LE(0) !== 3) throw new Error("solana-relay-program-mutable");
  try { verifySolanaProgramAuthority(state.data, genesis, 10143n, testnetAuthority); }
  catch { throw new Error("solana-relay-program-mutable"); }
  if (keccak256(state.data.subarray(45)) !== expectedHash) throw new Error("solana-relay-program-hash-mismatch");
}
