import { describe, expect, it, vi } from "vitest";
import { NATIVE_SOL_ASSET_BYTES, type CollateralSetupBinding } from "@termbook/schema";
import { hexToBytes } from "viem";
import { collateralSetupHash } from "../src/collateral/setup.js";
import {
  SolanaSourceLockWallet, decodeSolanaLockRecord, encodeSolanaLock,
  type SolanaAccountInfo, type SolanaInstruction, type SolanaRpcPort,
} from "../src/collateral/solana-source.js";
import { solanaPubkeyBase58 } from "../src/collateral/solana.js";
import { wormholeFixture } from "./solana-wormhole.fixture.js";

const key = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;

function binding(): CollateralSetupBinding {
  const genesis = key("f");
  const chain = { namespace: "solana" as const, reference: genesis };
  return {
    version: 1, monadChainId: 143, core: address("1"), creditId: key("2"), intentId: key("3"),
    termsHash: key("4"), borrower: address("5"), house: address("6"),
    sourceVault: { ...chain, accountBytes: key("7") },
    asset: { ...chain, kind: "native", assetBytes: NATIVE_SOL_ASSET_BYTES },
    amount: 1_000_000_000n, owner: { ...chain, accountBytes: key("8") },
    returnRecipient: { ...chain, accountBytes: key("9") },
    recoveryVault: { ...chain, accountBytes: key("a") }, sourceChainId: 1001,
    verifierVersion: 2n, setupDeadline: 9999999999, nonce: 1n,
  };
}

function record(binding: CollateralSetupBinding, lockId: `0x${string}`, pda: `0x${string}`): Uint8Array {
  if (binding.asset.namespace !== "solana" || binding.owner.namespace !== "solana"
    || binding.returnRecipient.namespace !== "solana" || binding.sourceVault.namespace !== "solana"
    || binding.recoveryVault?.namespace !== "solana") throw new Error("test-binding-invalid");
  const data = new Uint8Array(490);
  const view = new DataView(data.buffer);
  let cursor = 0;
  const put = (value: `0x${string}`) => {
    const encoded = hexToBytes(value);
    data.set(encoded, cursor);
    cursor += encoded.length;
  };
  const putU64 = (value: bigint) => { view.setBigUint64(cursor, value, true); cursor += 8; };
  data[cursor++] = 3;
  data[cursor++] = 254;
  put(lockId);
  put(binding.creditId);
  put(binding.owner.accountBytes);
  putU64(BigInt(binding.monadChainId));
  put(binding.core);
  put(binding.borrower);
  put(binding.asset.reference);
  put(binding.sourceVault.accountBytes);
  put(pda);
  put(NATIVE_SOL_ASSET_BYTES);
  put(binding.returnRecipient.accountBytes);
  put(binding.recoveryVault.accountBytes);
  put(binding.termsHash);
  putU64(binding.amount);
  putU64(binding.amount);
  view.setBigInt64(cursor, BigInt(binding.setupDeadline), true); cursor += 8;
  putU64(binding.verifierVersion!);
  putU64(0n);
  putU64(0n);
  put(key("0"));
  putU64(0n);
  put(key("0"));
  expect(cursor).toBe(490);
  return data;
}

function recoveryRecord(binding: CollateralSetupBinding, lockId: `0x${string}`, pda: `0x${string}`): Uint8Array {
  if (binding.owner.namespace !== "solana") throw new Error("test-binding-invalid");
  const data = new Uint8Array(282);
  data[0] = 3;
  data[1] = 253;
  let offset = 2;
  for (const value of [binding.creditId, lockId, binding.owner.accountBytes, pda]) {
    data.set(hexToBytes(value), offset);
    offset += 32;
  }
  offset += 8;
  data.set(hexToBytes(key("0")), offset);
  offset += 32 + 8 + 8;
  data.set(hexToBytes(key("0")), offset);
  offset += 32 + 8 + 8 + 8;
  data.set(hexToBytes(key("0")), offset);
  return data;
}

describe("Solana source wallet", () => {
  it("encodes the exact native SOL lock instruction and checks the finalized record", async () => {
    const b = binding();
    const lockId = collateralSetupHash(b);
    const pda = key("b");
    const programId = solanaPubkeyBase58(b.sourceVault.accountBytes as `0x${string}`);
    const owner = solanaPubkeyBase58(b.owner.accountBytes as `0x${string}`);
    const wormhole = wormholeFixture(owner, b.core, key("c"));
    const programDataAddress = solanaPubkeyBase58(key("e"));
    const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
    const programBytes = new Uint8Array(36);
    programBytes.set([2, 0, 0, 0]);
    programBytes.set(hexToBytes(key("e")), 4);
    const programDataBytes = new Uint8Array(45);
    programDataBytes.set([3, 0, 0, 0]);
    let lock: SolanaAccountInfo | null = null;
    let recovery: SolanaAccountInfo | null = null;
    const rpc: SolanaRpcPort = {
      getGenesisHash: async () => solanaPubkeyBase58(b.asset.reference as `0x${string}`),
      getAccountInfo: async (pubkey) => pubkey === programId
        ? { owner: loader, executable: true, lamports: 1n, data: programBytes }
        : pubkey === programDataAddress
          ? { owner: loader, executable: false, lamports: 1n, data: programDataBytes }
        : pubkey === wormhole.postedVaa ? wormhole.postedAccount
        : pubkey === solanaPubkeyBase58(b.recoveryVault!.accountBytes as `0x${string}`) ? recovery : lock,
      getMinimumBalanceForRentExemption: async () => 10_000n,
      getSignatureStatus: async () => ({ err: null, confirmationStatus: "finalized" }),
    };
    const send = vi.fn(async (_instruction: SolanaInstruction) => "2".repeat(88));
    const wallet = new SolanaSourceLockWallet({ rpcUrl: "https://invalid.example", rpc,
      wallet: { publicKey: owner, sendInstruction: send,
        prepareWormholeAuthorization: async () => wormhole },
      deriveLockPda: async () => solanaPubkeyBase58(pda),
      deriveRecoveryPda: async () => solanaPubkeyBase58(b.recoveryVault!.accountBytes as `0x${string}`) }, b.asset.reference as `0x${string}`);

    expect(encodeSolanaLock(b, lockId)).toHaveLength(265);
    expect(await wallet.observeLock(b, lockId)).toEqual({ state: "missing" });
    await wallet.submitLock(b, lockId, 2n, { actionHash: key("c"), authorizationTxHash: key("d") });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].programId).toBe(programId);
    expect(send.mock.calls[0]![0].keys.slice(0, 4)).toMatchObject([
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: solanaPubkeyBase58(pda), isSigner: false, isWritable: true },
      { pubkey: solanaPubkeyBase58(b.recoveryVault!.accountBytes as `0x${string}`), isSigner: false, isWritable: true },
      { pubkey: "11111111111111111111111111111111", isSigner: false, isWritable: false },
    ]);
    lock = { owner: programId, executable: false, lamports: b.amount + 10_000n,
      data: record(b, lockId, pda) };
    recovery = { owner: programId, executable: false, lamports: 10_000n,
      data: recoveryRecord(b, lockId, pda) };
    expect(decodeSolanaLockRecord(lock.data)).toMatchObject({ lockId, creditId: b.creditId, remainingAmount: b.amount });
    expect(await wallet.observeLock(b, lockId, "2".repeat(88))).toEqual({ state: "finalized", txId: "2".repeat(88) });
    lock.data[98] ^= 1;
    await expect(wallet.observeLock(b, lockId)).rejects.toThrow("solana-lock-record-mismatch");
  });
});
