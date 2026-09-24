import { describe, expect, it, vi } from "vitest";
import { hexToBytes } from "viem";
import { solanaRecoveryFundingHash, solanaRecoveryFundingInstruction,
  parseSolanaRecoveryFundingPlan, submitSolanaRecoveryFunding,
  solanaRecoveryPayoutHash, solanaRecoveryPayoutInstruction,
  parseSolanaRecoveryPayoutPlan, submitSolanaRecoveryPayout,
  solanaRecoveryRefundInstruction, submitSolanaRecoveryRefund,
  solanaRecoveryCheckpointInstruction,
  type SolanaRecoveryFunding, type SolanaRecoveryPayout,
  type SolanaRecoveryRefund } from "../src/collateral/solana-recovery.js";
import { solanaPubkeyBase58 } from "../src/collateral/solana.js";
import type { SolanaRpcPort } from "../src/collateral/solana-source.js";
import { wormholeFixture } from "./solana-wormhole.fixture.js";

const key = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
const address = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(20)}` as `0x${string}`;

function funding(): SolanaRecoveryFunding {
  return {
    monadChain: 143n, monadCore: address(3), sourceGenesis: key(5),
    programId: key(11), lockPda: key(10),
    recoveryVault: "0xbdbed3ace275888feac5c50579ebede02206f95bd9f8925e53f0f3f4ec16a28b",
    creditId: key(2), lockId: key(1), asset: key(1), operationId: key(12),
    operationDigest: key(13), inbox: address(14), depositPubkey: key(15),
    amountLamports: 500_000_000n, quoteHash: key(16), nonce: 1n,
    revision: 4n, deadline: 100n,
  };
}

function records(value: SolanaRecoveryFunding, held: bigint) {
  const lock = new Uint8Array(490);
  const recovery = new Uint8Array(282);
  const view = new DataView(lock.buffer);
  let cursor = 0;
  const put = (data: Uint8Array, value: `0x${string}`) => { data.set(hexToBytes(value), cursor); cursor += hexToBytes(value).length; };
  const u64 = (amount: bigint) => { view.setBigUint64(cursor, amount, true); cursor += 8; };
  lock[cursor++] = 3; lock[cursor++] = 254;
  put(lock, value.lockId); put(lock, value.creditId); put(lock, key(9));
  u64(value.monadChain); put(lock, value.monadCore); put(lock, address(4));
  put(lock, value.sourceGenesis); put(lock, value.programId); put(lock, value.lockPda);
  put(lock, value.asset); put(lock, key(6)); put(lock, value.recoveryVault); put(lock, key(8));
  u64(1_000_000_000n); u64(500_000_000n);
  view.setBigInt64(cursor, 100n, true); cursor += 8;
  u64(1n); u64(1n); u64(3n); put(lock, key(17)); u64(0n); put(lock, key(0));
  expect(cursor).toBe(490);
  recovery[0] = 3; recovery[1] = 253;
  cursor = 2;
  put(recovery, value.creditId); put(recovery, value.lockId); put(recovery, key(9));
  put(recovery, value.lockPda);
  new DataView(recovery.buffer).setBigUint64(cursor, held, true); cursor += 8;
  put(recovery, key(17));
  return { lock, recovery };
}

describe("Solana recovery funding", () => {
  it("encodes a recovery checkpoint after the requested deadline", () => {
    const request = funding();
    const wormhole = wormholeFixture(solanaPubkeyBase58(key(9)), request.monadCore, key(18));
    const checkpoint = {
      sourceGenesis: request.sourceGenesis, programId: request.programId,
      lockPda: request.lockPda, recoveryVault: request.recoveryVault,
      creditId: request.creditId, lockId: request.lockId, deadline: 100n,
    };
    const instruction = solanaRecoveryCheckpointInstruction(checkpoint, wormhole.snapshotAccounts);
    expect(instruction.keys).toHaveLength(13);
    expect(instruction.data[0]).toBe(6);
    expect(new DataView(instruction.data.buffer).getBigUint64(1, true)).toBe(100n);
  });

  it("matches the Rust funding hash and encodes the exact FundRecovery instruction", () => {
    const request = funding();
    const fundingHash = solanaRecoveryFundingHash(request);
    expect(fundingHash).toBe("0xe6a669e3cc25a4ef0e197c04252480c4e138da599fdf355db917b15c9a1bae08");
    const json = { fundingHash, authorizationTxHash: key(18),
      funding: Object.fromEntries(Object.entries(request).map(([name, value]) =>
        [name, typeof value === "bigint" ? value.toString() : value])) };
    const plan = parseSolanaRecoveryFundingPlan(json);
    const wormhole = wormholeFixture(solanaPubkeyBase58(key(9)), request.monadCore, fundingHash);
    const keys = [{ pubkey: wormhole.postedVaa, isSigner: false, isWritable: false },
      ...wormhole.snapshotAccounts];
    const instruction = solanaRecoveryFundingInstruction(plan, keys);
    expect(instruction.programId).toBe(solanaPubkeyBase58(request.programId));
    expect(instruction.keys.slice(0, 3).map((key) => key.pubkey)).toEqual([
      solanaPubkeyBase58(request.lockPda), solanaPubkeyBase58(request.recoveryVault),
      solanaPubkeyBase58(request.depositPubkey),
    ]);
    expect(instruction.data[0]).toBe(4);
    expect(instruction.data).toHaveLength(181);
    expect(() => parseSolanaRecoveryFundingPlan({ ...json, fundingHash: key(9) }))
      .toThrow("solana-recovery-plan-invalid");
  });

  it("checks the finalized held ledger before asking the Solana wallet to fund a route", async () => {
    const request = funding();
    const json = { fundingHash: solanaRecoveryFundingHash(request), authorizationTxHash: key(18),
      funding: Object.fromEntries(Object.entries(request).map(([name, value]) =>
        [name, typeof value === "bigint" ? value.toString() : value])) };
    let held = 500_000_000n;
    const wormhole = wormholeFixture(solanaPubkeyBase58(key(9)), request.monadCore, json.fundingHash);
    const rpc: SolanaRpcPort = {
      getGenesisHash: async () => solanaPubkeyBase58(request.sourceGenesis),
      getAccountInfo: async (pubkey) => {
        const record = records(request, held);
        const programId = solanaPubkeyBase58(request.programId);
        if (pubkey === programId) return { owner: programId, executable: true, lamports: 1n,
          data: new Uint8Array() };
        if (pubkey === wormhole.postedVaa) return wormhole.postedAccount;
        if (pubkey === solanaPubkeyBase58(request.lockPda)) return {
          owner: programId, executable: false, lamports: 500_000_100n, data: record.lock,
        };
        return { owner: programId, executable: false, lamports: held + 100n,
          data: record.recovery };
      },
      getMinimumBalanceForRentExemption: async () => 100n,
      getSignatureStatus: async () => null,
    };
    const sendInstruction = vi.fn(async () => "2".repeat(88));
    const wallet = { publicKey: solanaPubkeyBase58(key(9)), sendInstruction,
      prepareWormholeAuthorization: async () => wormhole };
    expect(await submitSolanaRecoveryFunding(json, wallet, rpc)).toBe("2".repeat(88));
    expect(sendInstruction).toHaveBeenCalledOnce();
    held = 0n;
    await expect(submitSolanaRecoveryFunding(json, wallet, rpc))
      .rejects.toThrow("solana-recovery-source-mismatch");
    expect(sendInstruction).toHaveBeenCalledOnce();
  });

  it("matches the Rust payout hash and checks the original return recipient", async () => {
    const request = funding();
    const payout: SolanaRecoveryPayout = {
      monadChain: request.monadChain, monadCore: request.monadCore,
      sourceGenesis: request.sourceGenesis, programId: request.programId,
      lockPda: request.lockPda, recoveryVault: request.recoveryVault,
      creditId: request.creditId, lockId: request.lockId, asset: request.asset,
      recipient: key(6), amountLamports: 500_000_000n,
      nonce: 1n, revision: 4n, deadline: 100n,
    };
    const payoutHash = solanaRecoveryPayoutHash(payout);
    expect(payoutHash).toBe("0x59b78f448854bb2eea58330ec822e6277cfa4a475fefbaa31395bae7c2ceca58");
    const json = { payoutHash, authorizationTxHash: key(18),
      payout: Object.fromEntries(Object.entries(payout).map(([name, value]) =>
        [name, typeof value === "bigint" ? value.toString() : value])) };
    const wormhole = wormholeFixture(solanaPubkeyBase58(key(9)), payout.monadCore, payoutHash);
    const keys = [{ pubkey: wormhole.postedVaa, isSigner: false, isWritable: false },
      ...wormhole.snapshotAccounts];
    const instruction = solanaRecoveryPayoutInstruction(parseSolanaRecoveryPayoutPlan(json), keys);
    expect(instruction.data[0]).toBe(3);
    expect(instruction.data).toHaveLength(65);
    expect(instruction.keys[2]?.pubkey).toBe(solanaPubkeyBase58(payout.recipient));
    let returned = key(6);
    const rpc: SolanaRpcPort = {
      getGenesisHash: async () => solanaPubkeyBase58(payout.sourceGenesis),
      getAccountInfo: async (pubkey) => {
        const programId = solanaPubkeyBase58(payout.programId);
        if (pubkey === programId) return { owner: programId, executable: true, lamports: 1n,
          data: new Uint8Array() };
        if (pubkey === wormhole.postedVaa) return wormhole.postedAccount;
        const record = records(request, 500_000_000n);
        if (pubkey === solanaPubkeyBase58(payout.lockPda)) {
          record.lock.set(hexToBytes(returned), 274);
          return { owner: programId, executable: false, lamports: 500_000_100n, data: record.lock };
        }
        return { owner: programId, executable: false, lamports: 500_000_100n, data: record.recovery };
      },
      getMinimumBalanceForRentExemption: async () => 100n,
      getSignatureStatus: async () => null,
    };
    const sendInstruction = vi.fn(async () => "2".repeat(88));
    const wallet = { publicKey: solanaPubkeyBase58(key(9)), sendInstruction,
      prepareWormholeAuthorization: async () => wormhole };
    expect(await submitSolanaRecoveryPayout(json, wallet, rpc)).toBe("2".repeat(88));
    returned = key(7);
    await expect(submitSolanaRecoveryPayout(json, wallet, rpc))
      .rejects.toThrow("solana-recovery-source-mismatch");
    expect(sendInstruction).toHaveBeenCalledOnce();
  });

  it("reconciles only physically returned SOL within the previously funded cap", async () => {
    const request = funding();
    const refund: SolanaRecoveryRefund = {
      sourceGenesis: request.sourceGenesis, programId: request.programId,
      lockPda: request.lockPda, recoveryVault: request.recoveryVault,
      creditId: request.creditId, lockId: request.lockId, amountLamports: 250n,
    };
    const wormhole = wormholeFixture(solanaPubkeyBase58(key(9)), address(3), key(18));
    const instruction = solanaRecoveryRefundInstruction(refund, wormhole.snapshotAccounts);
    expect(instruction.data).toHaveLength(9);
    expect(instruction.data[0]).toBe(5);
    expect(new DataView(instruction.data.buffer).getBigUint64(1, true)).toBe(250n);
    expect(instruction.keys.slice(0, 2).map((item) => item.isWritable)).toEqual([false, true]);
    let funded = 500n;
    let refunded = 100n;
    let balance = 100n + 100n + 250n;
    const rpc: SolanaRpcPort = {
      getGenesisHash: async () => solanaPubkeyBase58(refund.sourceGenesis),
      getAccountInfo: async (pubkey) => {
        const programId = solanaPubkeyBase58(refund.programId);
        if (pubkey === programId) return { owner: programId, executable: true,
          lamports: 1n, data: new Uint8Array() };
        const record = records(request, 100n);
        if (pubkey === solanaPubkeyBase58(refund.lockPda)) return {
          owner: programId, executable: false, lamports: 500_000_100n, data: record.lock,
        };
        const view = new DataView(record.recovery.buffer);
        view.setBigUint64(218, funded, true);
        view.setBigUint64(274, refunded, true);
        return { owner: programId, executable: false, lamports: balance, data: record.recovery };
      },
      getMinimumBalanceForRentExemption: async () => 100n,
      getSignatureStatus: async () => null,
    };
    const sendInstruction = vi.fn(async () => "2".repeat(88));
    const wallet = { publicKey: solanaPubkeyBase58(key(9)), sendInstruction,
      prepareWormholeSnapshot: async () => wormhole.snapshotAccounts };
    expect(await submitSolanaRecoveryRefund(refund, wallet, rpc)).toBe("2".repeat(88));
    refunded = 500n;
    await expect(submitSolanaRecoveryRefund(refund, wallet, rpc))
      .rejects.toThrow("solana-recovery-source-mismatch");
    funded = 0n;
    refunded = 0n;
    balance += 1_000n;
    await expect(submitSolanaRecoveryRefund(refund, wallet, rpc))
      .rejects.toThrow("solana-recovery-source-mismatch");
    expect(sendInstruction).toHaveBeenCalledOnce();
  });
});
