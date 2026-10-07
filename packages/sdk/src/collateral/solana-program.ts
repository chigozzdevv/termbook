import { bytesToHex } from "viem";
import { solanaPubkeyBytes } from "./solana.js";

export const SOLANA_DEVNET_GENESIS = solanaPubkeyBytes("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");

export function verifySolanaProgramAuthority(data: Uint8Array, genesis: string, monadChain: bigint,
  testnetAuthority?: string): void {
  if (data.length < 45 || data[12]! > 1) throw new Error("solana-program-authority-invalid");
  if (data[12] === 0) return;
  if (monadChain !== 10143n || genesis !== SOLANA_DEVNET_GENESIS || !testnetAuthority
    || solanaPubkeyBytes(testnetAuthority) !== bytesToHex(data.subarray(13, 45))
    || BigInt(bytesToHex(data.subarray(13, 45))) === 0n) throw new Error("solana-program-not-immutable");
}
