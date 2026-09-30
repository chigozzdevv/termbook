import { encodeAbiParameters, hexToBytes, keccak256, stringToHex } from "viem";
import { solanaPubkeyBase58 } from "./solana.js";
import { solanaPubkeyBytes } from "./solana.js";
import { decodeSolanaLockRecord, type SolanaInstruction, type SolanaRpcPort, type SolanaWalletPort } from "./solana-source.js";
import { prepareSolanaWormhole, submitSolanaLockCheckpoint } from "./solana-wormhole.js";

const domain = keccak256(stringToHex("Termbook Solana action v1"));
const word = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const maxU64 = (1n << 64n) - 1n;

export type SolanaRemoteAuthorization = {
  monadChain: bigint;
  monadCore: `0x${string}`;
  sourceGenesis: `0x${string}`;
  sourceVault: `0x${string}`;
  creditId: `0x${string}`;
  lockId: `0x${string}`;
  asset: `0x${string}`;
  kind: 0 | 1;
  recipient: `0x${string}`;
  amountLamports: bigint;
  nonce: bigint;
  revision: bigint;
  deadline: bigint;
  verifierVersion: bigint;
};

export type SolanaActionPlan = {
  programId: `0x${string}`;
  actionHash: `0x${string}`;
  action: SolanaRemoteAuthorization;
  authorizationTxHash: `0x${string}`;
  mode: "apply" | "expire";
};

function valid(action: SolanaRemoteAuthorization, programId: string): void {
  if (![action.sourceGenesis, action.sourceVault, action.creditId, action.lockId,
    action.asset, action.recipient, programId].every((value) => word.test(value) && BigInt(value) !== 0n)
    || !address.test(action.monadCore) || BigInt(action.monadCore) === 0n
    || (action.kind !== 0 && action.kind !== 1)
    || [action.monadChain, action.amountLamports, action.nonce, action.revision,
      action.deadline, action.verifierVersion].some((value) => value <= 0n || value > maxU64)
    || action.deadline > (1n << 63n) - 1n) throw new Error("solana-action-invalid");
}

function le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function solanaActionHash(action: SolanaRemoteAuthorization, programId: `0x${string}`): `0x${string}` {
  valid(action, programId);
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" },
    { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
    { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
    { type: "uint8" }, { type: "bytes32" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
  ], [
    domain, action.monadChain, action.monadCore, action.sourceGenesis, programId,
    action.sourceVault, action.creditId, action.lockId, action.asset, action.kind,
    action.recipient, action.amountLamports, action.nonce, action.revision,
    action.deadline, action.verifierVersion,
  ]));
}

export function solanaActionInstruction(plan: SolanaActionPlan, wormholeKeys: SolanaInstruction["keys"]): SolanaInstruction {
  const { action } = plan;
  valid(action, plan.programId);
  if (plan.mode !== "apply" && plan.mode !== "expire") throw new Error("solana-action-invalid");
  if (solanaActionHash(action, plan.programId).toLowerCase() !== plan.actionHash.toLowerCase()
    || !word.test(plan.authorizationTxHash) || wormholeKeys.length !== 12) {
    throw new Error("solana-action-proof-invalid");
  }
  const data = concat([
    new Uint8Array([plan.mode === "apply" ? 1 : 2]),
    le(action.monadChain), hexToBytes(action.monadCore), hexToBytes(action.sourceGenesis),
    hexToBytes(action.sourceVault), hexToBytes(action.creditId), hexToBytes(action.lockId),
    hexToBytes(action.asset), new Uint8Array([action.kind]), hexToBytes(action.recipient),
    le(action.amountLamports), le(action.nonce), le(action.revision), le(action.deadline),
    le(action.verifierVersion),
  ]);
  const keys = [{ pubkey: solanaPubkeyBase58(action.sourceVault), isSigner: false, isWritable: true }];
  if (plan.mode === "apply") keys.push({ pubkey: solanaPubkeyBase58(action.recipient), isSigner: false, isWritable: true });
  keys.push(...wormholeKeys);
  return { programId: solanaPubkeyBase58(plan.programId), keys, data };
}

export function parseSolanaActionPlan(value: unknown): SolanaActionPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("solana-action-plan-invalid");
  const plan = value as Record<string, unknown>;
  if (!plan["action"] || typeof plan["action"] !== "object" || Array.isArray(plan["action"])) {
    throw new Error("solana-action-plan-invalid");
  }
  const raw = plan["action"] as Record<string, unknown>;
  const number = (field: string) => {
    const item = raw[field];
    if (typeof item !== "string" || !/^[1-9][0-9]*$/.test(item)) throw new Error("solana-action-plan-invalid");
    return BigInt(item);
  };
  const hex = (field: string, pattern: RegExp) => {
    const item = raw[field];
    if (typeof item !== "string" || !pattern.test(item)) throw new Error("solana-action-plan-invalid");
    return item.toLowerCase() as `0x${string}`;
  };
  if (raw["kind"] !== 0 && raw["kind"] !== 1) throw new Error("solana-action-plan-invalid");
  const action: SolanaRemoteAuthorization = {
    monadChain: number("monadChain"), monadCore: hex("monadCore", address),
    sourceGenesis: hex("sourceGenesis", word), sourceVault: hex("sourceVault", word),
    creditId: hex("creditId", word), lockId: hex("lockId", word), asset: hex("asset", word),
    kind: raw["kind"],
    recipient: hex("recipient", word), amountLamports: number("amountLamports"),
    nonce: number("nonce"), revision: number("revision"), deadline: number("deadline"),
    verifierVersion: number("verifierVersion"),
  };
  if (typeof plan["programId"] !== "string" || !word.test(plan["programId"])
    || typeof plan["actionHash"] !== "string" || !word.test(plan["actionHash"])
    || typeof plan["authorizationTxHash"] !== "string" || !word.test(plan["authorizationTxHash"])
    || (plan["mode"] !== "apply" && plan["mode"] !== "expire")) {
    throw new Error("solana-action-plan-invalid");
  }
  const parsed: SolanaActionPlan = {
    programId: plan["programId"].toLowerCase() as `0x${string}`,
    actionHash: plan["actionHash"].toLowerCase() as `0x${string}`,
    authorizationTxHash: plan["authorizationTxHash"].toLowerCase() as `0x${string}`,
    mode: plan["mode"], action,
  };
  if (solanaActionHash(parsed.action, parsed.programId).toLowerCase() !== parsed.actionHash) {
    throw new Error("solana-action-plan-invalid");
  }
  return parsed;
}

export async function submitSolanaAction(planValue: unknown, wallet: SolanaWalletPort, rpc: SolanaRpcPort): Promise<string> {
  const plan = parseSolanaActionPlan(planValue);
  const { action } = plan;
  if (solanaPubkeyBytes(await rpc.getGenesisHash()) !== action.sourceGenesis) throw new Error("solana-genesis-mismatch");
  const programId = solanaPubkeyBase58(plan.programId);
  const [program, vault] = await Promise.all([
    rpc.getAccountInfo(programId), rpc.getAccountInfo(solanaPubkeyBase58(action.sourceVault)),
  ]);
  if (!program?.executable || !vault || vault.owner !== programId || vault.executable) {
    throw new Error("solana-action-source-unavailable");
  }
  const record = decodeSolanaLockRecord(vault.data);
  if (record.version !== 3 || record.monadChain !== action.monadChain
    || record.monadCore !== action.monadCore || record.genesis !== action.sourceGenesis
    || record.program !== plan.programId || record.vault !== action.sourceVault
    || record.creditId !== action.creditId || record.lockId !== action.lockId
    || record.asset !== action.asset || record.verifierVersion !== action.verifierVersion
    || (action.kind === 0 ? record.returnRecipient : record.recoveryVault) !== action.recipient) {
    throw new Error("solana-action-source-mismatch");
  }
  if (plan.mode === "apply" && record.lastNonce === action.nonce && record.lastRevision === action.revision
    && record.lastActionHash.toLowerCase() === plan.actionHash.toLowerCase()) {
    return submitSolanaLockCheckpoint(wallet, programId, solanaPubkeyBase58(action.sourceVault));
  }
  if (plan.mode === "expire" && record.lastCanceledNonce === action.nonce
    && record.lastCanceledActionHash.toLowerCase() === plan.actionHash.toLowerCase()) {
    return submitSolanaLockCheckpoint(wallet, programId, solanaPubkeyBase58(action.sourceVault));
  }
  if (record.lastNonce >= action.nonce || record.lastRevision >= action.revision
    || record.remainingAmount < action.amountLamports) throw new Error("solana-action-source-mismatch");
  const keys = await prepareSolanaWormhole(wallet, rpc, programId, action.monadCore,
    plan.actionHash, plan.authorizationTxHash);
  const signature = await wallet.sendInstruction(solanaActionInstruction(plan, keys));
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    throw new Error("solana-transaction-id-invalid");
  }
  return signature;
}
