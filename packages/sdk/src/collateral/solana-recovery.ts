import { concatHex, hexToBytes, keccak256, stringToHex } from "viem";
import { solanaPubkeyBase58, solanaPubkeyBytes } from "./solana.js";
import { decodeSolanaLockRecord, decodeSolanaRecoveryRecord,
  type SolanaInstruction, type SolanaRpcPort, type SolanaWalletPort } from "./solana-source.js";
import { prepareSolanaSnapshot, prepareSolanaWormhole } from "./solana-wormhole.js";

const domain = keccak256(stringToHex("Termbook Solana recovery fund v1"));
const payoutDomain = keccak256(stringToHex("Termbook Solana recovery payout v1"));
const word = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const maxU64 = (1n << 64n) - 1n;
const maxI64 = (1n << 63n) - 1n;
const zeroWord = `0x${"00".repeat(32)}`;

export type SolanaRecoveryFunding = {
  monadChain: bigint;
  monadCore: `0x${string}`;
  sourceGenesis: `0x${string}`;
  programId: `0x${string}`;
  lockPda: `0x${string}`;
  recoveryVault: `0x${string}`;
  creditId: `0x${string}`;
  lockId: `0x${string}`;
  asset: `0x${string}`;
  operationId: `0x${string}`;
  operationDigest: `0x${string}`;
  inbox: `0x${string}`;
  depositPubkey: `0x${string}`;
  amountLamports: bigint;
  quoteHash: `0x${string}`;
  nonce: bigint;
  revision: bigint;
  deadline: bigint;
};

export type SolanaRecoveryFundingPlan = {
  funding: SolanaRecoveryFunding;
  fundingHash: `0x${string}`;
  authorizationTxHash: `0x${string}`;
};

export type SolanaRecoveryPayout = {
  monadChain: bigint;
  monadCore: `0x${string}`;
  sourceGenesis: `0x${string}`;
  programId: `0x${string}`;
  lockPda: `0x${string}`;
  recoveryVault: `0x${string}`;
  creditId: `0x${string}`;
  lockId: `0x${string}`;
  asset: `0x${string}`;
  recipient: `0x${string}`;
  amountLamports: bigint;
  nonce: bigint;
  revision: bigint;
  deadline: bigint;
};

export type SolanaRecoveryPayoutPlan = {
  payout: SolanaRecoveryPayout;
  payoutHash: `0x${string}`;
  authorizationTxHash: `0x${string}`;
};

export type SolanaRecoveryRefund = {
  sourceGenesis: `0x${string}`;
  programId: `0x${string}`;
  lockPda: `0x${string}`;
  recoveryVault: `0x${string}`;
  creditId: `0x${string}`;
  lockId: `0x${string}`;
  amountLamports: bigint;
};

export type SolanaRecoveryCheckpoint = Omit<SolanaRecoveryRefund, "amountLamports"> & {
  deadline: bigint;
};

function valid(funding: SolanaRecoveryFunding): void {
  if (![funding.sourceGenesis, funding.programId, funding.lockPda, funding.recoveryVault,
    funding.creditId, funding.lockId, funding.asset, funding.operationId, funding.operationDigest,
    funding.depositPubkey, funding.quoteHash].every((value) => word.test(value) && BigInt(value) !== 0n)
    || !address.test(funding.monadCore) || BigInt(funding.monadCore) === 0n
    || !address.test(funding.inbox) || BigInt(funding.inbox) === 0n
    || [funding.monadChain, funding.amountLamports, funding.nonce, funding.revision,
      funding.deadline].some((value) => value <= 0n || value > maxU64)
    || funding.deadline > maxI64
    || [funding.recoveryVault, funding.lockPda].some((value) => value === funding.depositPubkey)) {
    throw new Error("solana-recovery-funding-invalid");
  }
}

function u64(value: bigint): Uint8Array {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setBigUint64(0, value, true);
  return data;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const data = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.length; }
  return data;
}

export function solanaRecoveryFundingHash(funding: SolanaRecoveryFunding): `0x${string}` {
  valid(funding);
  const number = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as `0x${string}`;
  const account = (value: `0x${string}`) => `0x${value.slice(2).padStart(64, "0")}` as `0x${string}`;
  return keccak256(concatHex([
    domain, number(funding.monadChain), account(funding.monadCore), funding.sourceGenesis,
    funding.programId, funding.recoveryVault, funding.creditId, funding.asset,
    funding.operationId, funding.operationDigest, account(funding.inbox), funding.depositPubkey,
    number(funding.amountLamports), funding.quoteHash, number(funding.nonce),
    number(funding.revision), number(funding.deadline),
  ]));
}

export function solanaRecoveryFundingInstruction(
  plan: SolanaRecoveryFundingPlan, wormholeKeys: SolanaInstruction["keys"],
): SolanaInstruction {
  const { funding } = plan;
  valid(funding);
  if (solanaRecoveryFundingHash(funding).toLowerCase() !== plan.fundingHash.toLowerCase()
    || !word.test(plan.authorizationTxHash) || wormholeKeys.length !== 12) {
    throw new Error("solana-recovery-proof-invalid");
  }
  const data = concat(
    new Uint8Array([4]), hexToBytes(funding.operationId), hexToBytes(funding.operationDigest),
    hexToBytes(funding.inbox), hexToBytes(funding.depositPubkey), u64(funding.amountLamports),
    hexToBytes(funding.quoteHash), u64(funding.nonce), u64(funding.revision), u64(funding.deadline),
  );
  return { programId: solanaPubkeyBase58(funding.programId), keys: [
    { pubkey: solanaPubkeyBase58(funding.lockPda), isSigner: false, isWritable: true },
    { pubkey: solanaPubkeyBase58(funding.recoveryVault), isSigner: false, isWritable: true },
    { pubkey: solanaPubkeyBase58(funding.depositPubkey), isSigner: false, isWritable: true },
    ...wormholeKeys,
  ], data };
}

export function parseSolanaRecoveryFundingPlan(value: unknown): SolanaRecoveryFundingPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("solana-recovery-plan-invalid");
  const plan = value as Record<string, unknown>;
  if (!plan["funding"] || typeof plan["funding"] !== "object" || Array.isArray(plan["funding"])) {
    throw new Error("solana-recovery-plan-invalid");
  }
  const raw = plan["funding"] as Record<string, unknown>;
  const hex = (value: unknown, pattern: RegExp) => {
    if (typeof value !== "string" || !pattern.test(value)) throw new Error("solana-recovery-plan-invalid");
    return value.toLowerCase() as `0x${string}`;
  };
  const number = (value: unknown) => {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) throw new Error("solana-recovery-plan-invalid");
    return BigInt(value);
  };
  const funding: SolanaRecoveryFunding = {
    monadChain: number(raw["monadChain"]), monadCore: hex(raw["monadCore"], address),
    sourceGenesis: hex(raw["sourceGenesis"], word), programId: hex(raw["programId"], word),
    lockPda: hex(raw["lockPda"], word), recoveryVault: hex(raw["recoveryVault"], word),
    creditId: hex(raw["creditId"], word), lockId: hex(raw["lockId"], word),
    asset: hex(raw["asset"], word), operationId: hex(raw["operationId"], word),
    operationDigest: hex(raw["operationDigest"], word), inbox: hex(raw["inbox"], address),
    depositPubkey: hex(raw["depositPubkey"], word), amountLamports: number(raw["amountLamports"]),
    quoteHash: hex(raw["quoteHash"], word), nonce: number(raw["nonce"]),
    revision: number(raw["revision"]), deadline: number(raw["deadline"]),
  };
  const parsed: SolanaRecoveryFundingPlan = {
    funding, fundingHash: hex(plan["fundingHash"], word),
    authorizationTxHash: hex(plan["authorizationTxHash"], word),
  };
  if (solanaRecoveryFundingHash(funding).toLowerCase() !== parsed.fundingHash) {
    throw new Error("solana-recovery-plan-invalid");
  }
  return parsed;
}

export async function submitSolanaRecoveryFunding(
  planValue: unknown, wallet: SolanaWalletPort, rpc: SolanaRpcPort,
): Promise<string> {
  const plan = parseSolanaRecoveryFundingPlan(planValue);
  const { funding } = plan;
  if (solanaPubkeyBytes(await rpc.getGenesisHash()) !== funding.sourceGenesis) throw new Error("solana-genesis-mismatch");
  const programId = solanaPubkeyBase58(funding.programId);
  const [program, lockAccount, recoveryAccount] = await Promise.all([
    rpc.getAccountInfo(programId), rpc.getAccountInfo(solanaPubkeyBase58(funding.lockPda)),
    rpc.getAccountInfo(solanaPubkeyBase58(funding.recoveryVault)),
  ]);
  if (!program?.executable || !lockAccount || !recoveryAccount
    || lockAccount.owner !== programId || lockAccount.executable
    || recoveryAccount.owner !== programId || recoveryAccount.executable) {
    throw new Error("solana-recovery-source-unavailable");
  }
  const lock = decodeSolanaLockRecord(lockAccount.data);
  const recovery = decodeSolanaRecoveryRecord(recoveryAccount.data);
  if (lock.version !== 3 || recovery.version !== 3 || lock.monadChain !== funding.monadChain
    || lock.monadCore !== funding.monadCore || lock.genesis !== funding.sourceGenesis
    || lock.program !== funding.programId || lock.vault !== funding.lockPda
    || lock.recoveryVault !== funding.recoveryVault || lock.creditId !== funding.creditId
    || lock.lockId !== funding.lockId || lock.asset !== funding.asset
    || recovery.creditId !== funding.creditId || recovery.lockId !== funding.lockId
    || recovery.sourceVault !== funding.lockPda || recovery.owner !== lock.owner
    || recovery.heldLamports < funding.amountLamports || recovery.lastSeizureHash === zeroWord
    || recovery.refundedLamports > recovery.fundedLamports
    || funding.depositPubkey === lock.returnRecipient
    || recovery.lastFundingNonce >= funding.nonce || recovery.lastPayoutNonce >= funding.nonce
    || lock.lastRevision >= funding.revision || recovery.lastFundingRevision >= funding.revision
    || recovery.lastPayoutRevision >= funding.revision
    || recoveryAccount.lamports < recovery.heldLamports
      + await rpc.getMinimumBalanceForRentExemption(recoveryAccount.data.length)) {
    throw new Error("solana-recovery-source-mismatch");
  }
  const keys = await prepareSolanaWormhole(wallet, rpc, programId, funding.monadCore,
    plan.fundingHash, plan.authorizationTxHash);
  const signature = await wallet.sendInstruction(solanaRecoveryFundingInstruction(plan, keys));
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    throw new Error("solana-transaction-id-invalid");
  }
  return signature;
}

function validPayout(payout: SolanaRecoveryPayout): void {
  if (![payout.sourceGenesis, payout.programId, payout.lockPda, payout.recoveryVault,
    payout.creditId, payout.lockId, payout.asset, payout.recipient]
    .every((value) => word.test(value) && BigInt(value) !== 0n)
    || !address.test(payout.monadCore) || BigInt(payout.monadCore) === 0n
    || [payout.monadChain, payout.amountLamports, payout.nonce, payout.revision,
      payout.deadline].some((value) => value <= 0n || value > maxU64)
    || payout.deadline > maxI64
    || payout.recipient === payout.lockPda || payout.recipient === payout.recoveryVault) {
    throw new Error("solana-recovery-payout-invalid");
  }
}

export function solanaRecoveryPayoutHash(payout: SolanaRecoveryPayout): `0x${string}` {
  validPayout(payout);
  const number = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as `0x${string}`;
  const account = `0x${payout.monadCore.slice(2).padStart(64, "0")}` as `0x${string}`;
  return keccak256(concatHex([
    payoutDomain, number(payout.monadChain), account, payout.sourceGenesis,
    payout.programId, payout.recoveryVault, payout.creditId, payout.asset,
    payout.recipient, number(payout.amountLamports), number(payout.nonce),
    number(payout.revision), number(payout.deadline),
  ]));
}

export function solanaRecoveryPayoutInstruction(
  plan: SolanaRecoveryPayoutPlan, wormholeKeys: SolanaInstruction["keys"],
): SolanaInstruction {
  const { payout } = plan;
  validPayout(payout);
  if (solanaRecoveryPayoutHash(payout).toLowerCase() !== plan.payoutHash.toLowerCase()
    || !word.test(plan.authorizationTxHash) || wormholeKeys.length !== 12) {
    throw new Error("solana-recovery-proof-invalid");
  }
  return { programId: solanaPubkeyBase58(payout.programId), keys: [
    { pubkey: solanaPubkeyBase58(payout.lockPda), isSigner: false, isWritable: true },
    { pubkey: solanaPubkeyBase58(payout.recoveryVault), isSigner: false, isWritable: true },
    { pubkey: solanaPubkeyBase58(payout.recipient), isSigner: false, isWritable: true },
    ...wormholeKeys,
  ], data: concat(new Uint8Array([3]), hexToBytes(payout.recipient),
    u64(payout.amountLamports), u64(payout.nonce), u64(payout.revision), u64(payout.deadline)) };
}

export function parseSolanaRecoveryPayoutPlan(value: unknown): SolanaRecoveryPayoutPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("solana-recovery-plan-invalid");
  const plan = value as Record<string, unknown>;
  if (!plan["payout"] || typeof plan["payout"] !== "object" || Array.isArray(plan["payout"])) {
    throw new Error("solana-recovery-plan-invalid");
  }
  const raw = plan["payout"] as Record<string, unknown>;
  const hex = (value: unknown, pattern: RegExp) => {
    if (typeof value !== "string" || !pattern.test(value)) throw new Error("solana-recovery-plan-invalid");
    return value.toLowerCase() as `0x${string}`;
  };
  const number = (value: unknown) => {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) throw new Error("solana-recovery-plan-invalid");
    return BigInt(value);
  };
  const payout: SolanaRecoveryPayout = {
    monadChain: number(raw["monadChain"]), monadCore: hex(raw["monadCore"], address),
    sourceGenesis: hex(raw["sourceGenesis"], word), programId: hex(raw["programId"], word),
    lockPda: hex(raw["lockPda"], word), recoveryVault: hex(raw["recoveryVault"], word),
    creditId: hex(raw["creditId"], word), lockId: hex(raw["lockId"], word),
    asset: hex(raw["asset"], word), recipient: hex(raw["recipient"], word),
    amountLamports: number(raw["amountLamports"]), nonce: number(raw["nonce"]),
    revision: number(raw["revision"]), deadline: number(raw["deadline"]),
  };
  const parsed: SolanaRecoveryPayoutPlan = {
    payout, payoutHash: hex(plan["payoutHash"], word),
    authorizationTxHash: hex(plan["authorizationTxHash"], word),
  };
  if (solanaRecoveryPayoutHash(payout).toLowerCase() !== parsed.payoutHash) {
    throw new Error("solana-recovery-plan-invalid");
  }
  return parsed;
}

export async function submitSolanaRecoveryPayout(
  planValue: unknown, wallet: SolanaWalletPort, rpc: SolanaRpcPort,
): Promise<string> {
  const plan = parseSolanaRecoveryPayoutPlan(planValue);
  const { payout } = plan;
  if (solanaPubkeyBytes(await rpc.getGenesisHash()) !== payout.sourceGenesis) throw new Error("solana-genesis-mismatch");
  const programId = solanaPubkeyBase58(payout.programId);
  const [program, lockAccount, recoveryAccount] = await Promise.all([
    rpc.getAccountInfo(programId), rpc.getAccountInfo(solanaPubkeyBase58(payout.lockPda)),
    rpc.getAccountInfo(solanaPubkeyBase58(payout.recoveryVault)),
  ]);
  if (!program?.executable || !lockAccount || !recoveryAccount
    || lockAccount.owner !== programId || lockAccount.executable
    || recoveryAccount.owner !== programId || recoveryAccount.executable) {
    throw new Error("solana-recovery-source-unavailable");
  }
  const lock = decodeSolanaLockRecord(lockAccount.data);
  const recovery = decodeSolanaRecoveryRecord(recoveryAccount.data);
  if (lock.version !== 3 || recovery.version !== 3 || lock.monadChain !== payout.monadChain
    || lock.monadCore !== payout.monadCore || lock.genesis !== payout.sourceGenesis
    || lock.program !== payout.programId || lock.vault !== payout.lockPda
    || lock.recoveryVault !== payout.recoveryVault || lock.creditId !== payout.creditId
    || lock.lockId !== payout.lockId || lock.asset !== payout.asset
    || lock.returnRecipient !== payout.recipient
    || recovery.creditId !== payout.creditId || recovery.lockId !== payout.lockId
    || recovery.sourceVault !== payout.lockPda || recovery.owner !== lock.owner
    || recovery.heldLamports < payout.amountLamports || recovery.lastSeizureHash === zeroWord
    || recovery.refundedLamports > recovery.fundedLamports
    || recovery.lastPayoutNonce >= payout.nonce || recovery.lastFundingNonce >= payout.nonce
    || lock.lastRevision >= payout.revision || recovery.lastPayoutRevision >= payout.revision
    || recovery.lastFundingRevision >= payout.revision
    || recoveryAccount.lamports < recovery.heldLamports
      + await rpc.getMinimumBalanceForRentExemption(recoveryAccount.data.length)) {
    throw new Error("solana-recovery-source-mismatch");
  }
  const keys = await prepareSolanaWormhole(wallet, rpc, programId, payout.monadCore,
    plan.payoutHash, plan.authorizationTxHash);
  const signature = await wallet.sendInstruction(solanaRecoveryPayoutInstruction(plan, keys));
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    throw new Error("solana-transaction-id-invalid");
  }
  return signature;
}

export function solanaRecoveryRefundInstruction(
  refund: SolanaRecoveryRefund, snapshotKeys: SolanaInstruction["keys"],
): SolanaInstruction {
  if (![refund.sourceGenesis, refund.programId, refund.lockPda, refund.recoveryVault,
    refund.creditId, refund.lockId].every((value) => word.test(value) && BigInt(value) !== 0n)
    || refund.amountLamports <= 0n || refund.amountLamports > maxU64
    || refund.lockPda === refund.recoveryVault || snapshotKeys.length !== 11) {
    throw new Error("solana-recovery-refund-invalid");
  }
  return { programId: solanaPubkeyBase58(refund.programId), keys: [
    { pubkey: solanaPubkeyBase58(refund.lockPda), isSigner: false, isWritable: false },
    { pubkey: solanaPubkeyBase58(refund.recoveryVault), isSigner: false, isWritable: true },
    ...snapshotKeys,
  ], data: concat(new Uint8Array([5]), u64(refund.amountLamports)) };
}

export async function submitSolanaRecoveryRefund(
  refund: SolanaRecoveryRefund, wallet: SolanaWalletPort, rpc: SolanaRpcPort,
): Promise<string> {
  if (solanaPubkeyBytes(await rpc.getGenesisHash()) !== refund.sourceGenesis) {
    throw new Error("solana-genesis-mismatch");
  }
  const programId = solanaPubkeyBase58(refund.programId);
  const snapshotKeys = await prepareSolanaSnapshot(wallet, programId);
  const instruction = solanaRecoveryRefundInstruction(refund, snapshotKeys);
  const [program, lockAccount, recoveryAccount] = await Promise.all([
    rpc.getAccountInfo(programId), rpc.getAccountInfo(solanaPubkeyBase58(refund.lockPda)),
    rpc.getAccountInfo(solanaPubkeyBase58(refund.recoveryVault)),
  ]);
  if (!program?.executable || !lockAccount || !recoveryAccount
    || lockAccount.owner !== programId || lockAccount.executable
    || recoveryAccount.owner !== programId || recoveryAccount.executable) {
    throw new Error("solana-recovery-source-unavailable");
  }
  const lock = decodeSolanaLockRecord(lockAccount.data);
  const recovery = decodeSolanaRecoveryRecord(recoveryAccount.data);
  if (lock.version !== 3 || recovery.version !== 3 || lock.genesis !== refund.sourceGenesis
    || lock.program !== refund.programId || lock.vault !== refund.lockPda
    || lock.recoveryVault !== refund.recoveryVault || lock.creditId !== refund.creditId
    || lock.lockId !== refund.lockId || recovery.creditId !== refund.creditId
    || recovery.lockId !== refund.lockId || recovery.owner !== lock.owner
    || recovery.sourceVault !== refund.lockPda || recovery.refundedLamports > recovery.fundedLamports
    || refund.amountLamports > recovery.fundedLamports - recovery.refundedLamports
    || recoveryAccount.lamports < recovery.heldLamports
      + refund.amountLamports + await rpc.getMinimumBalanceForRentExemption(recoveryAccount.data.length)) {
    throw new Error("solana-recovery-source-mismatch");
  }
  const signature = await wallet.sendInstruction(instruction);
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    throw new Error("solana-transaction-id-invalid");
  }
  return signature;
}

export function solanaRecoveryCheckpointInstruction(
  checkpoint: SolanaRecoveryCheckpoint, snapshotKeys: SolanaInstruction["keys"],
): SolanaInstruction {
  if (![checkpoint.sourceGenesis, checkpoint.programId, checkpoint.lockPda,
    checkpoint.recoveryVault, checkpoint.creditId, checkpoint.lockId]
    .every((value) => word.test(value) && BigInt(value) !== 0n)
    || checkpoint.deadline <= 0n || checkpoint.deadline > maxI64
    || checkpoint.lockPda === checkpoint.recoveryVault || snapshotKeys.length !== 11) {
    throw new Error("solana-recovery-checkpoint-invalid");
  }
  return { programId: solanaPubkeyBase58(checkpoint.programId), keys: [
    { pubkey: solanaPubkeyBase58(checkpoint.lockPda), isSigner: false, isWritable: false },
    { pubkey: solanaPubkeyBase58(checkpoint.recoveryVault), isSigner: false, isWritable: true },
    ...snapshotKeys,
  ], data: concat(new Uint8Array([6]), u64(checkpoint.deadline)) };
}

export async function submitSolanaRecoveryCheckpoint(
  checkpoint: SolanaRecoveryCheckpoint, wallet: SolanaWalletPort, rpc: SolanaRpcPort,
): Promise<string> {
  if (checkpoint.deadline >= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error("solana-recovery-checkpoint-not-due");
  }
  if (solanaPubkeyBytes(await rpc.getGenesisHash()) !== checkpoint.sourceGenesis) {
    throw new Error("solana-genesis-mismatch");
  }
  const programId = solanaPubkeyBase58(checkpoint.programId);
  const [program, lockAccount, recoveryAccount] = await Promise.all([
    rpc.getAccountInfo(programId), rpc.getAccountInfo(solanaPubkeyBase58(checkpoint.lockPda)),
    rpc.getAccountInfo(solanaPubkeyBase58(checkpoint.recoveryVault)),
  ]);
  if (!program?.executable || !lockAccount || !recoveryAccount
    || lockAccount.owner !== programId || recoveryAccount.owner !== programId
    || lockAccount.executable || recoveryAccount.executable) {
    throw new Error("solana-recovery-source-unavailable");
  }
  const lock = decodeSolanaLockRecord(lockAccount.data);
  const recovery = decodeSolanaRecoveryRecord(recoveryAccount.data);
  if (lock.genesis !== checkpoint.sourceGenesis || lock.program !== checkpoint.programId
    || lock.vault !== checkpoint.lockPda || lock.recoveryVault !== checkpoint.recoveryVault
    || lock.creditId !== checkpoint.creditId || lock.lockId !== checkpoint.lockId
    || recovery.creditId !== checkpoint.creditId || recovery.lockId !== checkpoint.lockId
    || recovery.sourceVault !== checkpoint.lockPda || recovery.owner !== lock.owner) {
    throw new Error("solana-recovery-source-mismatch");
  }
  const keys = await prepareSolanaSnapshot(wallet, programId);
  const signature = await wallet.sendInstruction(solanaRecoveryCheckpointInstruction(checkpoint, keys));
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    throw new Error("solana-transaction-id-invalid");
  }
  return signature;
}
