import { describe, expect, it, vi } from "vitest";
import { hexToBytes } from "viem";
import { parseSolanaActionPlan, solanaActionHash, solanaActionInstruction, submitSolanaAction,
  type SolanaRemoteAuthorization } from "../src/collateral/solana-action.js";
import { solanaPubkeyBase58 } from "../src/collateral/solana.js";
import type { SolanaRpcPort } from "../src/collateral/solana-source.js";

const key = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
const address = (byte: number) => `0x${byte.toString(16).padStart(2, "0").repeat(20)}` as `0x${string}`;

function lockRecord(action: SolanaRemoteAuthorization, programId: `0x${string}`, lastNonce = 0n) {
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
  u64(action.verifierVersion); u64(lastNonce); u64(0n);
  put(key(0)); u64(0n); put(key(0));
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
    const plan = { programId, actionHash, action, header: "0x12" as const,
      proof: "0x34" as const, mode: "apply" as const };
    const apply = solanaActionInstruction(plan);
    expect(apply.programId).toBe(solanaPubkeyBase58(programId));
    expect(apply.keys).toHaveLength(2);
    expect(apply.data).toHaveLength(272);
    expect(apply.data[0]).toBe(1);
    expect(apply.data[1]).toBe(143);
    const expire = solanaActionInstruction({ ...plan, mode: "expire" });
    expect(expire.keys).toHaveLength(1);
    expect(expire.data[0]).toBe(2);
    expect(() => solanaActionInstruction({ ...plan, actionHash: key(15) }))
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
      header: "0x12", proof: "0x34",
      action: Object.fromEntries(Object.entries(action).map(([name, value]) =>
        [name, typeof value === "bigint" ? value.toString() : value])) };
    expect(parseSolanaActionPlan(json).action.amountLamports).toBe(500_000_000n);
    let lastNonce = 0n;
    const rpc: SolanaRpcPort = {
      getGenesisHash: async () => solanaPubkeyBase58(action.sourceGenesis),
      getAccountInfo: async (pubkey) => pubkey === solanaPubkeyBase58(programId)
        ? { owner: solanaPubkeyBase58(programId), executable: true, lamports: 1n, data: new Uint8Array() }
        : { owner: solanaPubkeyBase58(programId), executable: false, lamports: 500_000_100n,
          data: lockRecord(action, programId, lastNonce) },
      getMinimumBalanceForRentExemption: async () => 100n,
      getSignatureStatus: async () => null,
    };
    const sendInstruction = vi.fn(async () => "2".repeat(88));
    const wallet = { publicKey: solanaPubkeyBase58(key(9)), sendInstruction };
    expect(await submitSolanaAction(json, wallet, rpc)).toBe("2".repeat(88));
    expect(sendInstruction).toHaveBeenCalledOnce();
    lastNonce = 1n;
    await expect(submitSolanaAction(json, wallet, rpc)).rejects.toThrow("solana-action-source-mismatch");
    expect(sendInstruction).toHaveBeenCalledOnce();
  });
});
