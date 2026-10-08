import { bytesToHex, keccak256, stringToHex, type Hex } from "viem";
import { solanaPubkeyBytes } from "./solana.js";
import type { SolanaInstruction, SolanaRpcPort, SolanaWalletPort } from "./solana-source.js";

export const SOLANA_WORMHOLE_CORE = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth";
export const SOLANA_TESTNET_WORMHOLE_CORE = "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5";
export type WormholeNetwork = "Mainnet" | "Testnet";
export function solanaWormholeCore(network: WormholeNetwork = "Mainnet"): string {
  return network === "Testnet" ? SOLANA_TESTNET_WORMHOLE_CORE : SOLANA_WORMHOLE_CORE;
}
function monadWormholeChain(network: WormholeNetwork = "Mainnet"): number {
  return network === "Testnet" ? 10009 : 48;
}
const authorizationDomain = keccak256(stringToHex("Termbook Monad authorization v1"));
const word = /^0x[0-9a-fA-F]{64}$/;

export type SolanaWormholeContext = {
  postedVaa: string;
  snapshotAccounts: SolanaInstruction["keys"];
};

export async function fetchMonadAuthorizationVaa(
  apiOrigin: string, txHash: Hex, monadCore: Hex, actionHash: Hex, network: WormholeNetwork = "Mainnet",
): Promise<Uint8Array> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)
    || !/^0x[0-9a-fA-F]{40}$/.test(monadCore) || !word.test(actionHash)) {
    throw new Error("solana-wormhole-authorization-invalid");
  }
  const url = new URL(apiOrigin);
  if (url.protocol !== "https:" || url.pathname !== "/") {
    throw new Error("solana-wormhole-api-invalid");
  }
  url.pathname = "/api/v1/vaas";
  url.search = new URLSearchParams({ txHash, pageSize: "100" }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" })
    .catch(() => { throw new Error("solana-wormhole-authorization-unavailable"); });
  if (!response.ok) throw new Error("solana-wormhole-authorization-unavailable");
  const bodyText = await response.text();
  if (bodyText.length > 500_000) throw new Error("solana-wormhole-authorization-invalid");
  let payload: unknown;
  try { payload = JSON.parse(bodyText); } catch { throw new Error("solana-wormhole-authorization-invalid"); }
  if (!payload || typeof payload !== "object" || !("data" in payload)
    || !Array.isArray(payload.data) || payload.data.length > 100) {
    throw new Error("solana-wormhole-authorization-invalid");
  }
  const matches: Uint8Array[] = [];
  for (const entry of payload.data) {
    if (!entry || typeof entry !== "object" || entry.emitterChain !== monadWormholeChain(network)
      || typeof entry.vaa !== "string" || entry.vaa.length > 128_000
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.vaa)) continue;
    let raw: Uint8Array;
    try { raw = Uint8Array.from(atob(entry.vaa), (char) => char.charCodeAt(0)); } catch { continue; }
    if (raw.length < 6 || raw.length > 96_000 || raw[0] !== 1) continue;
    const body = 6 + raw[5]! * 66;
    if (raw.length !== body + 51 + 64 || raw[body + 50] !== 0
      || new DataView(raw.buffer, raw.byteOffset).getUint16(body + 8, false) !== monadWormholeChain(network)
      || bytesToHex(raw.subarray(body + 10, body + 42))
        !== `0x${"00".repeat(12)}${monadCore.slice(2).toLowerCase()}`
      || bytesToHex(raw.subarray(body + 51, body + 83)) !== authorizationDomain
      || bytesToHex(raw.subarray(body + 83, body + 115)).toLowerCase() !== actionHash.toLowerCase()) {
      continue;
    }
    matches.push(raw);
  }
  if (matches.length !== 1) throw new Error("solana-wormhole-authorization-unavailable");
  return matches[0]!;
}

function validateSnapshotAccounts(wallet: SolanaWalletPort, metas: SolanaInstruction["keys"]): void {
  if (!Array.isArray(metas) || metas.length !== 11
    || metas[0]?.pubkey !== wallet.publicKey || !metas[0]?.isSigner || !metas[0]?.isWritable
    || metas[8]?.pubkey !== solanaWormholeCore(wallet.wormholeNetwork)
    || metas[7]?.pubkey !== "11111111111111111111111111111111" || metas[7]?.isSigner || metas[7]?.isWritable
    || metas.some((meta) => !meta || typeof meta.pubkey !== "string" ||
      typeof meta.isSigner !== "boolean" || typeof meta.isWritable !== "boolean")) {
    throw new Error("solana-wormhole-accounts-invalid");
  }
  for (const [index, meta] of metas.entries()) if (index !== 7) solanaPubkeyBytes(meta.pubkey);
}

export async function prepareSolanaSnapshot(wallet: SolanaWalletPort, programId: string) {
  if (!wallet.prepareWormholeSnapshot) throw new Error("solana-wormhole-unavailable");
  const metas = await wallet.prepareWormholeSnapshot(programId);
  validateSnapshotAccounts(wallet, metas);
  return metas;
}

export async function submitSolanaLockCheckpoint(
  wallet: SolanaWalletPort, programId: string, lockPda: string,
): Promise<string> {
  solanaPubkeyBytes(programId);
  solanaPubkeyBytes(lockPda);
  const keys = await prepareSolanaSnapshot(wallet, programId);
  const signature = await wallet.sendInstruction({ programId,
    keys: [{ pubkey: lockPda, isSigner: false, isWritable: false }, ...keys],
    data: new Uint8Array([7]) });
  if (!/^[1-9A-HJ-NP-Za-km-z]{85,88}$/.test(signature)) {
    throw new Error("solana-transaction-id-invalid");
  }
  return signature;
}

export async function prepareSolanaWormhole(
  wallet: SolanaWalletPort, rpc: SolanaRpcPort, programId: string,
  monadCore: Hex, actionHash: Hex, authorizationTxHash?: Hex,
): Promise<SolanaInstruction["keys"]> {
  if (!wallet.prepareWormholeAuthorization || !word.test(actionHash)) {
    throw new Error("solana-wormhole-unavailable");
  }
  const context = await wallet.prepareWormholeAuthorization({
    programId, monadCore, actionHash, authorizationTxHash,
  });
  const account = await rpc.getAccountInfo(context.postedVaa);
  if (!account || account.owner !== solanaWormholeCore(wallet.wormholeNetwork) || account.executable
    || account.data.length !== 159 || bytesToHex(account.data.subarray(0, 3)) !== "0x766161"
    || account.data[3] !== 1 || account.data[4] !== 0
    || new DataView(account.data.buffer, account.data.byteOffset).getUint16(57, true) !== monadWormholeChain(wallet.wormholeNetwork)
    || bytesToHex(account.data.subarray(59, 91))
      !== `0x${"00".repeat(12)}${monadCore.slice(2).toLowerCase()}`
    || new DataView(account.data.buffer, account.data.byteOffset).getUint32(91, true) !== 64
    || bytesToHex(account.data.subarray(95, 127)) !== authorizationDomain
    || bytesToHex(account.data.subarray(127, 159)).toLowerCase() !== actionHash.toLowerCase()) {
    throw new Error("solana-wormhole-authorization-invalid");
  }
  const metas = context.snapshotAccounts;
  validateSnapshotAccounts(wallet, metas);
  solanaPubkeyBytes(context.postedVaa);
  return [{ pubkey: context.postedVaa, isSigner: false, isWritable: false }, ...metas];
}
