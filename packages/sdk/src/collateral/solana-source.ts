import { NATIVE_SOL_ASSET_BYTES, collateralSetupBindingSchema, type CollateralSetupBinding } from "@termbook/schema";
import { hexToBytes, bytesToHex } from "viem";
import type { TxHash } from "../types/client.types.js";
import { collateralSetupHash, type SourceLockObservation, type SourceLockWallet } from "./setup.js";
import { solanaPubkeyBase58, solanaPubkeyBytes } from "./solana.js";
import { verifySolanaProgramAuthority } from "./solana-program.js";
import { prepareSolanaWormhole, type WormholeNetwork, type SolanaWormholeContext } from "./solana-wormhole.js";

const systemProgram = "11111111111111111111111111111111";
const upgradeableLoader = "BPFLoaderUpgradeab1e11111111111111111111111";
const zeroHash = `0x${"00".repeat(32)}`;
const lockRecordSize = 490;
const recoveryRecordSize = 282;
const maxU64 = (1n << 64n) - 1n;

export type SolanaInstruction = {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
};

export type SolanaWalletPort = {
  testnetUpgradeAuthority?: string;
  wormholeNetwork?: WormholeNetwork;
  publicKey: string;
  sendInstruction(instruction: SolanaInstruction): Promise<string>;
  prepareWormholeAuthorization?(input: {
    programId: string; monadCore: `0x${string}`; actionHash: `0x${string}`;
    authorizationTxHash?: `0x${string}`;
  }): Promise<SolanaWormholeContext>;
  prepareWormholeSnapshot?(programId: string): Promise<SolanaInstruction["keys"]>;
};

export type SolanaAccountInfo = {
  owner: string;
  lamports: bigint;
  executable: boolean;
  data: Uint8Array;
};

export type SolanaRpcPort = {
  getGenesisHash(): Promise<string>;
  getAccountInfo(pubkey: string): Promise<SolanaAccountInfo | null>;
  getMinimumBalanceForRentExemption(size: number): Promise<bigint>;
  getSignatureStatus(signature: string): Promise<{ err: unknown; confirmationStatus: string } | null>;
};

export type SolanaSourceWalletConfig = {
  rpcUrl: string;
  wallet: SolanaWalletPort;
  deriveLockPda(lockId: TxHash, programId: string): Promise<string>;
  deriveRecoveryPda(creditId: TxHash, programId: string): Promise<string>;
  rpc?: SolanaRpcPort;
};

function bytes(value: `0x${string}`, size: number): Uint8Array {
  const result = hexToBytes(value);
  if (result.length !== size) throw new Error("solana-field-invalid");
  return result;
}

function u64(value: bigint): Uint8Array {
  if (value < 0n || value > maxU64) throw new Error("solana-amount-invalid");
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}

function i64(value: bigint): Uint8Array {
  if (value < 0n || value > (1n << 63n) - 1n) throw new Error("solana-deadline-invalid");
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigInt64(0, value, true);
  return result;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function encodeSolanaLock(binding: CollateralSetupBinding, lockId: TxHash): Uint8Array {
  collateralSetupBindingSchema.parse(binding);
  if (binding.asset.namespace !== "solana" || binding.owner.namespace !== "solana"
    || binding.returnRecipient.namespace !== "solana" || binding.sourceVault.namespace !== "solana"
    || binding.recoveryVault?.namespace !== "solana" || binding.asset.kind !== "native"
    || binding.asset.assetBytes !== NATIVE_SOL_ASSET_BYTES
    || collateralSetupHash(binding).toLowerCase() !== lockId.toLowerCase()) throw new Error("solana-lock-binding-invalid");
  return concat(
    new Uint8Array([0]), bytes(lockId, 32), bytes(binding.creditId, 32), u64(BigInt(binding.monadChainId)),
    bytes(binding.core, 20), bytes(binding.borrower, 20), bytes(binding.asset.reference as `0x${string}`, 32),
    bytes(binding.returnRecipient.accountBytes, 32), bytes(binding.recoveryVault.accountBytes, 32),
    bytes(binding.termsHash, 32), u64(binding.amount), i64(BigInt(binding.setupDeadline)),
    u64(binding.verifierVersion!),
  );
}

type LockRecord = {
  version: number; lockId: TxHash; creditId: TxHash; owner: TxHash;
  monadChain: bigint; monadCore: `0x${string}`; borrower: `0x${string}`;
  genesis: TxHash; program: TxHash; vault: TxHash; asset: TxHash;
  returnRecipient: TxHash; recoveryVault: TxHash; termsHash: TxHash;
  initialAmount: bigint; remainingAmount: bigint; setupDeadline: bigint;
  verifierVersion: bigint; lastNonce: bigint; lastRevision: bigint; lastActionHash: TxHash;
  lastCanceledNonce: bigint; lastCanceledActionHash: TxHash;
};

export function decodeSolanaLockRecord(data: Uint8Array): LockRecord {
  if (data.length !== lockRecordSize) throw new Error("solana-lock-record-invalid");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  const byte = () => data[offset++]!;
  const readHex = (size: number) => {
    const value = bytesToHex(data.slice(offset, offset + size));
    offset += size;
    return value;
  };
  const readU64 = () => {
    const value = view.getBigUint64(offset, true);
    offset += 8;
    return value;
  };
  const readI64 = () => {
    const value = view.getBigInt64(offset, true);
    offset += 8;
    return value;
  };
  const version = byte();
  byte();
  const lockId = readHex(32);
  const creditId = readHex(32);
  const owner = readHex(32);
  const monadChain = readU64();
  const monadCore = readHex(20);
  const borrower = readHex(20);
  const genesis = readHex(32);
  const program = readHex(32);
  const vault = readHex(32);
  const asset = readHex(32);
  const returnRecipient = readHex(32);
  const recoveryVault = readHex(32);
  const termsHash = readHex(32);
  const initialAmount = readU64();
  const remainingAmount = readU64();
  const setupDeadline = readI64();
  const verifierVersion = readU64();
  const lastNonce = readU64();
  const lastRevision = readU64();
  const lastActionHash = readHex(32);
  const lastCanceledNonce = readU64();
  const lastCanceledActionHash = readHex(32);
  if (offset !== lockRecordSize) throw new Error("solana-lock-record-invalid");
  return { version, lockId, creditId, owner, monadChain, monadCore, borrower, genesis,
    program, vault, asset, returnRecipient, recoveryVault, termsHash, initialAmount,
    remainingAmount, setupDeadline, verifierVersion, lastNonce, lastRevision, lastActionHash,
    lastCanceledNonce, lastCanceledActionHash };
}

export function decodeSolanaRecoveryRecord(data: Uint8Array) {
  if (data.length !== recoveryRecordSize) throw new Error("solana-recovery-record-invalid");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  const version = data[offset++]!;
  offset++;
  const readHex = (size: number) => {
    const value = bytesToHex(data.slice(offset, offset + size));
    offset += size;
    return value;
  };
  const creditId = readHex(32);
  const lockId = readHex(32);
  const owner = readHex(32);
  const sourceVault = readHex(32);
  const heldLamports = view.getBigUint64(offset, true);
  offset += 8;
  const lastSeizureHash = readHex(32);
  const lastPayoutNonce = view.getBigUint64(offset, true);
  offset += 8;
  const lastPayoutRevision = view.getBigUint64(offset, true);
  offset += 8;
  const lastPayoutHash = readHex(32);
  const fundedLamports = view.getBigUint64(offset, true);
  offset += 8;
  const lastFundingNonce = view.getBigUint64(offset, true);
  offset += 8;
  const lastFundingRevision = view.getBigUint64(offset, true);
  offset += 8;
  const lastFundingHash = readHex(32);
  const refundedLamports = view.getBigUint64(offset, true);
  offset += 8;
  if (offset !== recoveryRecordSize) throw new Error("solana-recovery-record-invalid");
  return { version, creditId, lockId, owner, sourceVault, heldLamports, lastSeizureHash,
    lastPayoutNonce, lastPayoutRevision, lastPayoutHash,
    fundedLamports, lastFundingNonce, lastFundingRevision, lastFundingHash, refundedLamports };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("solana-rpc-invalid");
  return value as Record<string, unknown>;
}

export class SolanaJsonRpc implements SolanaRpcPort {
  readonly url: string;

  constructor(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("solana-rpc-invalid");
    this.url = parsed.toString();
  }

  private async call(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(this.url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000), redirect: "error",
    });
    if (!response.ok) throw new Error("solana-rpc-unavailable");
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error("solana-rpc-invalid");
    const payload = object(JSON.parse(body));
    if (payload["jsonrpc"] !== "2.0" || payload["id"] !== 1 || payload["error"] || payload["result"] === undefined) throw new Error("solana-rpc-invalid");
    return payload["result"];
  }

  async getGenesisHash(): Promise<string> {
    const value = await this.call("getGenesisHash", []);
    if (typeof value !== "string") throw new Error("solana-rpc-invalid");
    solanaPubkeyBytes(value);
    return value;
  }

  async getAccountInfo(pubkey: string): Promise<SolanaAccountInfo | null> {
    solanaPubkeyBytes(pubkey);
    const envelope = object(await this.call("getAccountInfo", [pubkey, { commitment: "finalized", encoding: "base64" }]));
    if (envelope["value"] === null) return null;
    const value = object(envelope["value"]);
    const data = value["data"];
    if (typeof value["owner"] !== "string" || !Number.isSafeInteger(value["lamports"])
      || !Array.isArray(data) || data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64"
      || typeof value["executable"] !== "boolean") throw new Error("solana-rpc-invalid");
    solanaPubkeyBytes(value["owner"]);
    const binary = atob(data[0]);
    return { owner: value["owner"], lamports: BigInt(value["lamports"] as number),
      executable: value["executable"], data: Uint8Array.from(binary, (char) => char.charCodeAt(0)) };
  }

  async getMinimumBalanceForRentExemption(size: number): Promise<bigint> {
    const value = await this.call("getMinimumBalanceForRentExemption", [size, { commitment: "finalized" }]);
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("solana-rpc-invalid");
    return BigInt(value as number);
  }

  async getSignatureStatus(signature: string): Promise<{ err: unknown; confirmationStatus: string } | null> {
    const result = object(await this.call("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]));
    if (!Array.isArray(result["value"]) || result["value"].length !== 1) throw new Error("solana-rpc-invalid");
    return result["value"][0] === null ? null : object(result["value"][0]) as { err: unknown; confirmationStatus: string };
  }
}

export class SolanaSourceLockWallet implements SourceLockWallet {
  readonly account: { namespace: "solana"; reference: `0x${string}`; accountBytes: `0x${string}` };
  readonly config: SolanaSourceWalletConfig;
  readonly rpc: SolanaRpcPort;

  constructor(config: SolanaSourceWalletConfig, sourceGenesis: `0x${string}`) {
    solanaPubkeyBase58(sourceGenesis);
    this.account = { namespace: "solana", reference: sourceGenesis, accountBytes: solanaPubkeyBytes(config.wallet.publicKey) };
    this.config = config;
    this.rpc = config.rpc ?? new SolanaJsonRpc(config.rpcUrl);
  }

  async submitAction(plan: unknown): Promise<{ txId: string }> {
    const { submitSolanaAction } = await import("./solana-action.js");
    return { txId: await submitSolanaAction(plan, this.config.wallet, this.rpc) };
  }

  private async checked(binding: CollateralSetupBinding): Promise<string> {
    collateralSetupBindingSchema.parse(binding);
    if (binding.asset.namespace !== "solana" || binding.sourceVault.namespace !== "solana"
      || binding.owner.namespace !== "solana" || binding.returnRecipient.namespace !== "solana"
      || binding.recoveryVault?.namespace !== "solana" || binding.asset.kind !== "native"
      || binding.asset.assetBytes !== NATIVE_SOL_ASSET_BYTES
      || binding.asset.reference !== this.account.reference
      || binding.owner.accountBytes !== this.account.accountBytes) throw new Error("solana-wallet-binding-mismatch");
    const programId = solanaPubkeyBase58(binding.sourceVault.accountBytes);
    const recoveryPda = solanaPubkeyBytes(await this.config.deriveRecoveryPda(binding.creditId, programId));
    if (recoveryPda !== binding.recoveryVault.accountBytes) throw new Error("solana-recovery-pda-mismatch");
    if (solanaPubkeyBytes(await this.rpc.getGenesisHash()) !== binding.asset.reference) throw new Error("solana-genesis-mismatch");
    const program = await this.rpc.getAccountInfo(programId);
    if (!program?.executable) throw new Error("solana-program-unavailable");
    return programId;
  }

  async preflight(binding: CollateralSetupBinding): Promise<void> {
    await this.checked(binding);
  }

  async remoteRecoveryVault(binding: CollateralSetupBinding): Promise<`0x${string}`> {
    await this.checked(binding);
    if (binding.recoveryVault?.namespace !== "solana") throw new Error("solana-recovery-vault-invalid");
    return binding.recoveryVault.accountBytes;
  }

  async lockPda(binding: CollateralSetupBinding, lockId: TxHash): Promise<`0x${string}`> {
    const programId = await this.checked(binding);
    const pda = await this.config.deriveLockPda(lockId, programId);
    const encoded = solanaPubkeyBytes(pda);
    if (encoded === this.account.accountBytes || encoded === binding.returnRecipient.accountBytes
      || encoded === binding.recoveryVault?.accountBytes) throw new Error("solana-lock-pda-invalid");
    return encoded;
  }

  async observeLock(binding: CollateralSetupBinding, lockId: TxHash, txId?: string): Promise<SourceLockObservation> {
    const programId = await this.checked(binding);
    if (collateralSetupHash(binding) !== lockId) throw new Error("solana-lock-binding-invalid");
    const pda = await this.lockPda(binding, lockId);
    const [account, recoveryAccount] = await Promise.all([
      this.rpc.getAccountInfo(solanaPubkeyBase58(pda)),
      this.rpc.getAccountInfo(solanaPubkeyBase58(binding.recoveryVault!.accountBytes)),
    ]);
    if (!account && !recoveryAccount) {
      if (!txId) return { state: "missing" };
      const status = await this.rpc.getSignatureStatus(txId);
      if (status?.err) return { state: "failed", txId };
      return { state: "submitted", txId };
    }
    if (!account || !recoveryAccount) throw new Error("solana-lock-record-mismatch");
    const record = decodeSolanaLockRecord(account.data);
    const recoveryRecord = decodeSolanaRecoveryRecord(recoveryAccount.data);
    const expected: [string, string][] = [
      [record.lockId, lockId], [record.creditId, binding.creditId], [record.owner, this.account.accountBytes],
      [record.monadCore, binding.core], [record.borrower, binding.borrower],
      [record.genesis, binding.asset.reference], [record.program, binding.sourceVault.accountBytes],
      [record.vault, pda], [record.asset, NATIVE_SOL_ASSET_BYTES],
      [record.returnRecipient, binding.returnRecipient.accountBytes],
      [record.recoveryVault, binding.recoveryVault!.accountBytes], [record.termsHash, binding.termsHash],
    ];
    if (account.owner !== programId || account.executable || record.version !== 3
      || expected.some(([actual, wanted]) => actual.toLowerCase() !== wanted.toLowerCase())
      || record.monadChain !== BigInt(binding.monadChainId)
      || record.initialAmount !== binding.amount || record.remainingAmount !== binding.amount
      || record.setupDeadline !== BigInt(binding.setupDeadline)
      || record.verifierVersion !== binding.verifierVersion
      || record.lastNonce !== 0n || record.lastRevision !== 0n || record.lastActionHash !== zeroHash
      || record.lastCanceledNonce !== 0n || record.lastCanceledActionHash !== zeroHash
      || recoveryAccount.owner !== programId || recoveryAccount.executable
      || recoveryRecord.version !== 3 || recoveryRecord.creditId !== binding.creditId
      || recoveryRecord.lockId !== lockId || recoveryRecord.owner !== this.account.accountBytes
      || recoveryRecord.sourceVault !== pda || recoveryRecord.heldLamports !== 0n
      || recoveryRecord.lastSeizureHash !== zeroHash
      || recoveryRecord.lastPayoutNonce !== 0n || recoveryRecord.lastPayoutRevision !== 0n
      || recoveryRecord.lastPayoutHash !== zeroHash || recoveryRecord.fundedLamports !== 0n
      || recoveryRecord.lastFundingNonce !== 0n || recoveryRecord.lastFundingRevision !== 0n
      || recoveryRecord.lastFundingHash !== zeroHash || recoveryRecord.refundedLamports !== 0n
      || account.lamports < binding.amount + await this.rpc.getMinimumBalanceForRentExemption(lockRecordSize)
      || recoveryAccount.lamports < await this.rpc.getMinimumBalanceForRentExemption(recoveryRecordSize)) {
      throw new Error("solana-lock-record-mismatch");
    }
    if (txId) {
      const status = await this.rpc.getSignatureStatus(txId);
      if (status?.err) throw new Error("solana-lock-transaction-failed");
      if (status?.confirmationStatus !== "finalized") return { state: "submitted", txId };
    }
    return { state: "finalized", txId };
  }

  async submitLock(binding: CollateralSetupBinding, lockId: TxHash, revision: bigint,
    wormhole?: { actionHash: TxHash; authorizationTxHash?: TxHash }): Promise<{ txId: string }> {
    if (revision <= 0n || binding.setupDeadline <= Math.floor(Date.now() / 1000)) throw new Error("solana-lock-expired");
    if (!wormhole) throw new Error("solana-wormhole-unavailable");
    const programId = await this.checked(binding);
    const pda = await this.lockPda(binding, lockId);
    const wormholeKeys = await prepareSolanaWormhole(this.config.wallet, this.rpc, programId,
      binding.core, wormhole.actionHash, wormhole.authorizationTxHash);
    const program = await this.rpc.getAccountInfo(programId);
    if (!program?.executable || program.owner !== upgradeableLoader
      || program.data.length !== 36
      || new DataView(program.data.buffer, program.data.byteOffset).getUint32(0, true) !== 2) {
      throw new Error("solana-program-not-immutable");
    }
    const programDataAddress = solanaPubkeyBase58(bytesToHex(program.data.subarray(4, 36)));
    const programData = await this.rpc.getAccountInfo(programDataAddress);
    if (!programData || programData.owner !== upgradeableLoader
      || programData.data.length < 45
      || new DataView(programData.data.buffer, programData.data.byteOffset).getUint32(0, true) !== 3) throw new Error("solana-program-not-immutable");
    verifySolanaProgramAuthority(programData.data, binding.asset.reference, BigInt(binding.monadChainId),
      this.config.wallet.testnetUpgradeAuthority);
    const instruction: SolanaInstruction = {
      programId,
      keys: [
        { pubkey: this.config.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: solanaPubkeyBase58(pda), isSigner: false, isWritable: true },
        { pubkey: solanaPubkeyBase58(binding.recoveryVault!.accountBytes), isSigner: false, isWritable: true },
        { pubkey: systemProgram, isSigner: false, isWritable: false },
        wormholeKeys[0]!,
        { pubkey: programId, isSigner: false, isWritable: false },
        { pubkey: programDataAddress, isSigner: false, isWritable: false },
        ...wormholeKeys.slice(1),
      ],
      data: encodeSolanaLock(binding, lockId),
    };
    const txId = await this.config.wallet.sendInstruction(instruction);
    if (typeof txId !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(txId)) throw new Error("solana-transaction-id-invalid");
    return { txId };
  }
}
