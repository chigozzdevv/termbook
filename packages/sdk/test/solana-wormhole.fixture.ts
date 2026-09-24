import { hexToBytes, keccak256, stringToHex, type Hex } from "viem";
import { solanaPubkeyBase58 } from "../src/collateral/solana.js";
import { SOLANA_WORMHOLE_CORE } from "../src/collateral/solana-wormhole.js";

const key = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as Hex;

export function wormholeFixture(payer: string, monadCore: Hex, actionHash: Hex) {
  const postedVaa = solanaPubkeyBase58(key(19));
  const data = new Uint8Array(159);
  data.set([0x76, 0x61, 0x61, 1, 0]);
  data.set([1, 0, 0, 0], 5);
  data.set([1, 0, 0, 0], 41);
  new DataView(data.buffer).setUint16(57, 48, true);
  data.set(hexToBytes(monadCore), 71);
  new DataView(data.buffer).setUint32(91, 64, true);
  data.set(hexToBytes(keccak256(stringToHex("Termbook Monad authorization v1"))), 95);
  data.set(hexToBytes(actionHash), 127);
  const snapshotAccounts = Array.from({ length: 11 }, (_, index) => ({
    pubkey: index === 0 ? payer : index === 8 ? SOLANA_WORMHOLE_CORE
      : solanaPubkeyBase58(key(20 + index)),
    isSigner: index === 0,
    isWritable: index <= 5,
  }));
  return {
    postedVaa,
    snapshotAccounts,
    postedAccount: { owner: SOLANA_WORMHOLE_CORE, executable: false, lamports: 1n, data },
  };
}
