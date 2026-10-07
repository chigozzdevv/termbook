import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { keccak256, type Hex } from "viem";
import { solanaBase58Bytes } from "../src/collateral/solana-proof.js";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const loader = "BPFLoaderUpgradeab1e11111111111111111111111";

const emissionShim = "EtZMZM22ViKMo4r5y4Anovs3wKQ2owUmDpjygnMMcdEX";
const [rpcUrl, programId, expectedGenesis, expectedHash, monadChainId = "143", flag, testnetAuthority] = process.argv.slice(2);
if (process.argv.length > 9 || flag && (flag !== "--testnet-upgrade-authority" || !testnetAuthority)) {
  throw new Error("solana-upgrade-argument-invalid");
}

if (monadChainId !== "143" && monadChainId !== "10143") throw new Error("monad-network-invalid");
const wormholeCore = monadChainId === "10143"
  ? "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5" : "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth";
const networkGenesis = monadChainId === "10143" ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" : "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N";

if (!rpcUrl || !programId || !/^0x[0-9a-fA-F]{64}$/.test(expectedGenesis ?? "")
  || !/^0x[0-9a-fA-F]{64}$/.test(expectedHash ?? "")) {
  throw new Error("Usage: tsx server/scripts/verify-solana-program.ts <rpc-url> <program-id> <genesis-hex> <program-data-hash> [143|10143] [--testnet-upgrade-authority <public-key>]");
}

function encode58(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let output = "";
  while (value > 0n) {
    output = alphabet[Number(value % 58n)] + output;
    value /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return "1".repeat(zeros) + output;
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(rpcUrl!, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000), redirect: "error",
  });
  if (!response.ok) throw new Error("solana-rpc-unavailable");
  const result = await response.json() as Record<string, unknown>;
  if (result["error"] || result["result"] === undefined) throw new Error("solana-rpc-invalid");
  return result["result"];
}

async function account(address: string) {
  const result = await rpc("getAccountInfo", [address, { commitment: "finalized", encoding: "base64" }]) as {
    value?: { owner: string; executable: boolean; data: [string, string] } | null;
  };
  const value = result.value;
  if (!value || !Array.isArray(value.data) || value.data[1] !== "base64") {
    throw new Error("solana-account-unavailable");
  }
  return { ...value, data: Buffer.from(value.data[0], "base64") };
}

function emitterPda(program: Uint8Array): string {
  for (let bump = 255; bump >= 0; bump--) {
    const candidate = createHash("sha256").update("emitter").update(Buffer.from([bump]))
      .update(program).update("ProgramDerivedAddress").digest();
    try {
      ed25519.ExtendedPoint.fromHex(candidate);
    } catch {
      return encode58(candidate);
    }
  }
  throw new Error("solana-emitter-unavailable");
}

const genesis = solanaBase58Bytes(await rpc("getGenesisHash", []) as string);
if (genesis.toLowerCase() !== expectedGenesis.toLowerCase() || genesis !== solanaBase58Bytes(networkGenesis)) throw new Error("solana-genesis-mismatch");
const program = await account(programId);
if (!program.executable || program.owner !== loader || program.data.length !== 36
  || program.data.readUInt32LE(0) !== 2) throw new Error("solana-program-invalid");
const programDataAddress = encode58(program.data.subarray(4, 36));
const programData = await account(programDataAddress);
if (programData.executable || programData.owner !== loader || programData.data.length <= 45
  || programData.data.readUInt32LE(0) !== 3 || programData.data[12]! > 1) {
  throw new Error("solana-program-not-immutable");
}
if (programData.data[12] === 1 && (monadChainId !== "10143" || !testnetAuthority
  || encode58(programData.data.subarray(13, 45)) !== testnetAuthority)) throw new Error("solana-program-upgrade-authority-mismatch");
const hash = keccak256(`0x${programData.data.subarray(45).toString("hex")}` as Hex);
if (hash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error("solana-program-hash-mismatch");
const [core, shim] = await Promise.all([account(wormholeCore), account(emissionShim)]);
if (!core.executable || !shim.executable) throw new Error("solana-wormhole-unavailable");
const emitter = emitterPda(Buffer.from(solanaBase58Bytes(programId).slice(2), "hex"));
console.log(JSON.stringify({
  genesis, programId, programIdHex: solanaBase58Bytes(programId),
  programDataAddress, programDataHash: hash,
  emitter, emitterHex: solanaBase58Bytes(emitter),
  wormholeCore, emissionShim, immutable: programData.data[12] === 0,
  upgradeAuthority: programData.data[12] === 1 ? testnetAuthority : undefined,
}, null, 2));
