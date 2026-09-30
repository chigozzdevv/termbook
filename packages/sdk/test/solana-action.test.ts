import { describe, expect, it, vi } from "vitest";
import { hexToBytes } from "viem";
import { parseSolanaActionPlan, solanaActionHash, solanaActionInstruction, submitSolanaAction,
  type SolanaRemoteAuthorization } from "../src/collateral/solana-action.js";
import { solanaPubkeyBase58 } from "../src/collateral/solana.js";
import type { SolanaRpcPort, SolanaInstruction } from "../src/collateral/solana-source.js";
import { wormholeFixture } from "./solana-wormhole.fixture.js";

const key = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
const address = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(20)}` as `0x${string}`;

function lockRecord(action: SolanaRemoteAuthorization, programId: `0x${string}`, lastNonce = 0n,
  lastRevision = 0n, lastHash = key(0), canceledNonce = 0n, canceledHash = key(0)) {
  const data = new Uint8Array(490);
  const view = new DataView(data.buffer);
  let cursor = 0;
  const put = (value: `0x${string}`) => { const bytes = hexToBytes(value); data.set(bytes, cursor); cursor += bytes.length; };
  const u64 = (value: bigint) => { view.setBigUint64(cursor, value, true); cursor += 8; };
  data[cursor++] = 3;
  data[cursor++] = 254;
  put(action.lockId); put(action.creditId); put(key(9));
  u64(action.monadChain); put(action.monadCore); put(address(4));
  put(action.sourceGenesis); put(programId); put(action.sourceVault); put(action.asset);
  put(action.recipient); put(key(7)); put(key(8));
  u64(action.amountLamports); u64(action.amountLamports);
  view.setBigInt64(cursor, action.deadline, true); cursor += 8;
  u64(action.verifierVersion); u64(lastNonce); u64(lastRevision);
  put(lastHash); u64(canceledNonce); put(canceledHash);
  expect(cursor).toBe(490);
  return data;
}

describe("Solana source action instruction", () => {
  it("matches the Rust action hash vector and Borsh Apply and Expire variants", () => {
    const programId = key(11);
    const action: SolanaRemoteAuthorization = {
      monadChain: 143n, monadCore: address(3), sourceGenesis: key(5),
      sourceVault: key(10), creditId: key(2), lockId: key(1),
      asset: key(1), kind: 0, recipient: key(6), amountLamports: 500_000_000n,
      nonce: 1n, revision: 2n, deadline: 100n, verifierVersion: 1n,
    };
    const actionHash = solanaActionHash(action, programId);
    expect(actionHash).toBe("0x1c59eb45703b3dd1375020a5568a87c6f7f687fcdd96a56dfc6d4f66c04616c8");
    const plan = { programId, actionHash, action, authorizationTxHash: key(18), mode: "apply" as const };
    const keys = Array.from({ length: 12 }, () => ({
      pubkey: solanaPubkeyBase58(key(19)), isSigner: false, isWritable: false,
    }));
    const apply = solanaActionInstruction(plan, keys);
    expect(apply.programId).toBe(solanaPubkeyBase58(programId));
    expect(apply.keys).toHaveLength(14);
    expect(apply.data).toHaveLength(262);
    expect(apply.data[0]).toBe(1);
    expect(apply.data[1]).toBe(143);
    const expire = solanaActionInstruction({ ...plan, mode: "expire" }, keys);
    expect(expire.keys).toHaveLength(13);
    expect(expire.data[0]).toBe(2);
    expect(() => solanaActionInstruction({ ...plan, actionHash: key(15) }, keys))
      .toThrow("solana-action-proof-invalid");
  });

  it("parses the JSON plan and checks finalized source state before asking the wallet to submit", async () => {
    const programId = key(11);
    const action: SolanaRemoteAuthorization = {
      monadChain: 143n, monadCore: address(3), sourceGenesis: key(5),
      sourceVault: key(10), creditId: key(2), lockId: key(1), asset: key(1),
      kind: 0, recipient: key(6), amountLamports: 500_000_000n,
      nonce: 1n, revision: 2n, deadline: 100n, verifierVersion: 1n,
    };
    const json = { programId, actionHash: solanaActionHash(action, programId), mode: "apply",
      authorizationTxHash: key(18),
      action: Object.fromEntries(Object.entries(action).map(([name, value]) =>
        [name, typeof value === "bigint" ? value.toString() : value])) };
    expect(parseSolanaActionPlan(json).action.amountLamports).toBe(500_000_000n);
    const wormhole = wormholeFixture(solanaPubkeyBase58(key(9)), action.monadCore, json.actionHash);
    let lastNonce = 0n;
    let lastRevision = 0n;
    let lastHash = key(0);
    let canceledNonce = 0n;
    let canceledHash = key(0);
    const rpc: SolanaRpcPort = {
      getGenesisHash: async () => solanaPubkeyBase58(action.sourceGenesis),
      getAccountInfo: async (pubkey) => pubkey === solanaPubkeyBase58(programId)
        ? { owner: solanaPubkeyBase58(programId), executable: true, lamports: 1n, data: new Uint8Array() }
        : pubkey === wormhole.postedVaa ? wormhole.postedAccount
        : { owner: solanaPubkeyBase58(programId), executable: false, lamports: 500_000_100n,
          data: lockRecord(action, programId, lastNonce, lastRevision, lastHash, canceledNonce, canceledHash) },
      getMinimumBalanceForRentExemption: async () => 100n,
      getSignatureStatus: async () => null,
    };
    const sendInstruction = vi.fn(async (_instruction: SolanaInstruction) => "2".repeat(88));
    const wallet = { publicKey: solanaPubkeyBase58(key(9)), sendInstruction,
      prepareWormholeAuthorization: async () => wormhole,
      prepareWormholeSnapshot: async () => wormhole.snapshotAccounts };
    expect(await submitSolanaAction(json, wallet, rpc)).toBe("2".repeat(88));
    expect(sendInstruction).toHaveBeenCalledOnce();
    lastNonce = 1n;
    await expect(submitSolanaAction(json, wallet, rpc)).rejects.toThrow("solana-action-source-mismatch");
    expect(sendInstruction).toHaveBeenCalledOnce();
    lastRevision = action.revision;
    lastHash = json.actionHash;
    expect(await submitSolanaAction(json, wallet, rpc)).toBe("2".repeat(88));
    expect(sendInstruction).toHaveBeenCalledTimes(2);
    expect(sendInstruction.mock.calls[1]?.[0]).toMatchObject({ data: new Uint8Array([7]) });
    lastNonce = 0n; lastRevision = 0n; lastHash = key(0);
    canceledNonce = action.nonce; canceledHash = json.actionHash;
    expect(await submitSolanaAction({ ...json, mode: "expire" }, wallet, rpc)).toBe("2".repeat(88));
    expect(sendInstruction.mock.calls[2]?.[0]).toMatchObject({ data: new Uint8Array([7]) });
  });
});
