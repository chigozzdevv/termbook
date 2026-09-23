import { describe, expect, it, vi } from "vitest";
import type { CollateralSetupBinding } from "@termbook/schema";
import type { TermbookClient } from "../src/client/client.js";
import { CollateralSetup, collateralSetupHash, restoreCollateralSetup } from "../src/collateral/setup.js";
import { Intent } from "../src/intent/intent.js";
import { EvmSourceLockWallet, evmRemoteLockCommitment, evmSourceLockCall } from "../src/collateral/evm-source.js";
import { encodeAbiParameters, keccak256 } from "viem";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const hash = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;

function binding(): CollateralSetupBinding {
  const chain = { namespace: "eip155" as const, reference: "1" };
  return {
    version: 1,
    monadChainId: 143,
    core: address("1"),
    creditId: hash("2"),
    intentId: hash("3"),
    termsHash: hash("4"),
    borrower: address("5"),
    house: address("6"),
    sourceVault: { ...chain, accountBytes: address("7") },
    asset: { ...chain, kind: "erc20", assetBytes: address("8") },
    amount: 10n,
    owner: { ...chain, accountBytes: address("9") },
    returnRecipient: { ...chain, accountBytes: address("a") },
    setupDeadline: 9999999999,
    nonce: 17n,
  };
}

describe("collateral setup", () => {
  it("binds the lock id to chain, owner, recipient and exact terms", () => {
    const base = binding();
    const id = collateralSetupHash(base);
    expect(id).toMatch(/^0x[a-f0-9]{64}$/);
    expect(collateralSetupHash({ ...base, termsHash: hash("f") })).not.toBe(id);
    expect(collateralSetupHash({ ...base, owner: { ...base.owner, accountBytes: address("b") } })).not.toBe(id);
    expect(collateralSetupHash({ ...base, returnRecipient: { ...base.returnRecipient, accountBytes: address("c") } })).not.toBe(id);
    expect(collateralSetupHash({
      ...base,
      asset: { namespace: "eip155", reference: "11155111", kind: "erc20", assetBytes: address("8") },
      owner: { namespace: "eip155", reference: "11155111", accountBytes: address("9") },
      returnRecipient: { namespace: "eip155", reference: "11155111", accountBytes: address("a") },
      sourceVault: { namespace: "eip155", reference: "11155111", accountBytes: address("7") },
    })).not.toBe(id);
  });

  it("sends native MON value to the native vault without ERC-20 approval", () => {
    const base = binding();
    const local: CollateralSetupBinding = {
      ...base,
      sourceVault: { namespace: "eip155", reference: "143", accountBytes: address("7") },
      asset: { namespace: "eip155", reference: "143", kind: "erc20", assetBytes: address("8") },
      owner: { namespace: "eip155", reference: "143", accountBytes: address("9") },
      returnRecipient: { namespace: "eip155", reference: "143", accountBytes: address("a") },
    };
    const lockId = collateralSetupHash(local);
    const native = evmSourceLockCall(local, lockId, 2n, true);
    expect(native).toEqual({
      functionName: "lockNativeWithDeadline",
      args: [lockId, local.creditId, local.owner.accountBytes, local.amount, local.returnRecipient.accountBytes, BigInt(local.setupDeadline), 2n],
      value: local.amount,
    });
    expect(evmSourceLockCall(local, lockId, 2n)).toEqual({ functionName: "lockWithDeadline", args: native.args });
    expect(() => evmSourceLockCall(local, hash("f"), 2n, true)).toThrow("source-lock-id-mismatch");
  });

  it("uses the remote lock entrypoint and the Core commitment fields", () => {
    const b = binding();
    const lockId = collateralSetupHash(b);
    const recoveryVault = address("e");
    expect(evmSourceLockCall(b, lockId, 2n)).toEqual({
      functionName: "lockRemoteWithDeadline",
      args: [lockId, b.creditId, b.borrower, b.owner.accountBytes, b.amount, b.returnRecipient.accountBytes, BigInt(b.setupDeadline), 2n],
    });
    expect(evmRemoteLockCommitment(b, lockId, recoveryVault)).toBe(keccak256(encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
        { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" },
        { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" },
      ],
      [b.creditId, lockId, b.borrower, b.owner.accountBytes, b.sourceVault.accountBytes, b.asset.assetBytes, b.amount, 1n, b.returnRecipient.accountBytes, recoveryVault, 143n, b.core],
    )));
    expect(() => evmRemoteLockCommitment(b, lockId, address("0"))).toThrow("source-recovery-vault-invalid");
    expect(() => evmSourceLockCall(b, lockId, 2n, true)).toThrow("remote-native-vault-unavailable");
  });

  it("checks the finalized source commitment before reporting a remote lock", async () => {
    const b = binding();
    const lockId = collateralSetupHash(b);
    const adapter = new EvmSourceLockWallet({
      chainId: 1, rpcUrl: "https://invalid.example",
      wallet: { address: b.owner.accountBytes, signTypedData: async () => hash("a"), getChainId: async () => 1 },
      vault: b.sourceVault.accountBytes, asset: b.asset.assetBytes as `0x${string}`, controller: address("d"),
    });
    let commitment = hash("0");
    let controllerCore = b.core;
    const readContract = vi.fn(async (request: { functionName: string; blockTag?: string }) => {
      if (request.functionName === "isNativeCollateralVault") return false;
      if (request.functionName === "asset") return b.asset.assetBytes;
      if (request.functionName === "core") return address("d");
      if (request.functionName === "chainId_") return 1n;
      if (request.functionName === "recoveryVault") return address("e");
      if (request.functionName === "monadChain") return 143n;
      if (request.functionName === "monadCore") return controllerCore;
      if (request.functionName === "controller") return address("d");
      if (request.functionName === "lockInfo") return [b.creditId, b.owner.accountBytes, b.asset.assetBytes, 1n, b.amount, b.returnRecipient.accountBytes, BigInt(b.setupDeadline), 2n, true, false, false];
      if (request.functionName === "lockCommitments") return commitment;
      throw new Error("unexpected-read");
    });
    (adapter as unknown as { rpc: unknown }).rpc = { getChainId: async () => 1, readContract };
    await expect(adapter.observeLock(b, lockId)).rejects.toThrow("source-lock-commitment-mismatch");
    commitment = evmRemoteLockCommitment(b, lockId, address("e"));
    await expect(adapter.observeLock(b, lockId)).resolves.toEqual({ state: "finalized", txId: undefined });
    controllerCore = address("f");
    await expect(adapter.preflight(b)).rejects.toThrow("source-controller-mismatch");
    expect(readContract.mock.calls.every(([request]) => request.blockTag === "finalized")).toBe(true);
  });

  it("checks the vault kind before accepting a native MON lock", async () => {
    const base = binding();
    const chain = { namespace: "eip155" as const, reference: "143" };
    const local: CollateralSetupBinding = {
      ...base,
      sourceVault: { ...chain, accountBytes: base.sourceVault.accountBytes },
      asset: { ...chain, kind: "erc20", assetBytes: base.asset.assetBytes },
      owner: { ...chain, accountBytes: base.owner.accountBytes },
      returnRecipient: { ...chain, accountBytes: base.returnRecipient.accountBytes },
    };
    const adapter = (nativeVault?: boolean) => new EvmSourceLockWallet({
      chainId: 143, rpcUrl: "https://invalid.example",
      wallet: { address: local.owner.accountBytes, signTypedData: async () => hash("a"), getChainId: async () => 143 },
      vault: local.sourceVault.accountBytes, asset: local.asset.assetBytes as `0x${string}`,
      controller: local.core, nativeVault,
    });
    const attachRpc = (wallet: EvmSourceLockWallet, native: boolean | null) => {
      (wallet as unknown as { rpc: unknown }).rpc = {
        getChainId: async () => 143,
        readContract: async ({ functionName }: { functionName: string }) => {
          if (functionName === "isNativeCollateralVault") {
            if (native === null) throw new Error("selector-unavailable");
            return native;
          }
          if (functionName === "asset") return local.asset.assetBytes;
          if (functionName === "core") return local.core;
          if (functionName === "chainId_") return 143n;
          throw new Error("unexpected-read");
        },
      };
    };
    const omitted = adapter();
    attachRpc(omitted, true);
    await expect(omitted.preflight(local)).rejects.toThrow("source-vault-native-required");
    const native = adapter(true);
    attachRpc(native, true);
    await expect(native.preflight(local)).resolves.toBeUndefined();
    const misclassified = adapter(true);
    attachRpc(misclassified, false);
    await expect(misclassified.preflight(local)).rejects.toThrow("source-vault-not-native");
    const erc20 = adapter();
    attachRpc(erc20, false);
    await expect(erc20.preflight(local)).resolves.toBeUndefined();
    const unknown = adapter();
    attachRpc(unknown, null);
    await expect(unknown.preflight(local)).rejects.toThrow("source-vault-kind-unverified");
  });

  it("requires an independent source wallet before reserving and resumes through proof", async () => {
    const b = binding();
    const onchain: Record<string, unknown> = { revision: 0n };
    let reservations = 0;
    let locks = 0;
    let sourceFinalized = false;
    let sourceRecoveryVault = address("f");
    let proofs = 0;
    const stages: string[] = [];
    let account = address("0");
    const client = {
      config: { chainId: 143, core: b.core, accountFactory: address("b"), wallet: { getChainId: async () => 143 } },
      signer: { address: () => b.borrower },
      rpc: {
        creditDetails: async () => onchain,
        read: async (_address: string, _abi: unknown, fn: string) => {
          if (fn === "collateralSourceChainOf") return 1n;
          if (fn === "collateralOwnerOf") return b.owner.accountBytes;
          if (fn === "remoteRecoveryVaultOf") return address("e");
          if (fn === "collateralProven") return Boolean(onchain["proven"]);
          if (fn === "accountOf") return account;
          throw new Error(`unexpected-read:${fn}`);
        },
        wait: async () => ({ status: "success" }),
        coreWrite: async (fn: string) => {
          if (fn === "bindRemoteCollateral") {
            onchain["collateralBound"] = true;
            onchain["lockId"] = collateralSetupHash(b);
          } else if (fn === "proveCollateral") {
            proofs += 1;
            onchain["proven"] = true;
          } else if (fn === "bindAccount") {
            onchain["account"] = account;
            onchain["facility"] = 4;
          } else throw new Error(`unexpected-write:${fn}`);
          return hash("d");
        },
        write: async () => {
          account = address("c");
          return hash("e");
        },
      },
    } as unknown as TermbookClient;
    const wallet = {
      account: b.owner,
      remoteRecoveryVault: async () => sourceRecoveryVault,
      observeLock: async () => ({ state: locks === 0 ? "missing" as const : sourceFinalized ? "finalized" as const : "submitted" as const, txId: locks ? hash("f") : undefined }),
      submitLock: async () => {
        locks += 1;
        return { txId: hash("f") };
      },
    };
    const options = {
      sourceWallet: wallet,
      reserve: async () => {
        reservations += 1;
        Object.assign(onchain, {
          revision: 2n, facility: 1, borrower: b.borrower, house: b.house, termsHash: b.termsHash,
          collateralVault: b.sourceVault.accountBytes, collateralAsset: b.asset.assetBytes,
          collateralAmount: b.amount, returnRecipient: b.returnRecipient.accountBytes,
          collateralBound: false, account: address("0"), lockId: hash("0"),
        });
        return hash("a");
      },
      onProgress: async (checkpoint: { stage: string }) => { stages.push(checkpoint.stage); },
    };
    const setup = new CollateralSetup(client, b, options);
    await expect(setup.resume()).rejects.toThrow("source-recovery-vault-mismatch");
    expect(reservations).toBe(1);
    expect(locks).toBe(0);
    sourceRecoveryVault = address("e");
    expect((await setup.resume()).stage).toBe("awaiting_finality");
    expect(reservations).toBe(1);
    expect(locks).toBe(1);
    sourceFinalized = true;
    expect((await setup.resume()).stage).toBe("proof_pending");
    expect(proofs).toBe(0);
    const restored = new CollateralSetup(client, b, { ...options, checkpoint: setup.snapshot(), proofSource: { getProof: async () => ({ header: hash("1"), proof: hash("2") }) } });
    expect((await restored.resume()).stage).toBe("ready");
    expect(reservations).toBe(1);
    expect(locks).toBe(1);
    expect(proofs).toBe(1);
    expect(stages).toContain("reserved");
    expect(stages).toContain("ready");
  });

  it("rejects a checkpoint from another credit or terms", () => {
    const b = binding();
    const client = { config: { chainId: 143, core: b.core }, signer: { address: () => b.borrower } } as TermbookClient;
    const setup = new CollateralSetup(client, b);
    const restored = restoreCollateralSetup(setup.serialize());
    expect(restored.binding.amount).toBe(b.amount);
    expect(restored.checkpoint.bindingHash).toBe(setup.bindingHash);
    const altered = JSON.parse(setup.serialize()) as { binding: { termsHash: string } };
    altered.binding.termsHash = hash("e");
    expect(() => restoreCollateralSetup(JSON.stringify(altered))).toThrow("setup-checkpoint-mismatch");
    expect(() => new CollateralSetup(client, { ...b, termsHash: hash("f") }, { checkpoint: setup.snapshot() })).toThrow("setup-checkpoint-mismatch");
    expect(() => new CollateralSetup(client, b, { sourceWallet: { account: { ...b.owner, accountBytes: address("d") }, observeLock: async () => ({ state: "missing" }), submitLock: async () => ({ txId: hash("e") }) } })).toThrow("source-wallet-mismatch");
  });

  it("submits native Solana intent without truncating 32-byte identities", async () => {
    const source = { namespace: "solana" as const, reference: `0x${"f".repeat(64)}` as `0x${string}` };
    const key = `0x${"1".repeat(64)}` as `0x${string}`;
    let submitted: unknown;
    const client = {
      config: { apiBase: "https://invalid.example" }, signer: { address: () => address("5") },
      authenticatedPost: async (_path: string, payload: unknown) => { submitted = payload; return { intentId: hash("1") }; },
    } as unknown as TermbookClient;
    const intent = new Intent(client, {
      collateral: { chain: source, asset: { ...source, kind: "native", assetBytes: NATIVE_SOL_ASSET_BYTES }, amount: 1n, owner: { ...source, accountBytes: key }, returnRecipient: { ...source, accountBytes: key } },
      credit: { limit: 10n, duration: 3600 },
    });
    expect(await intent.submit()).toBe(hash("1"));
    expect(submitted).toMatchObject({ collateral: { chain: source, owner: { ...source, accountBytes: key }, amount: "1" } });
  });

  it("accepts the borrower quote first and returns pending while source finality is outstanding", async () => {
    const b = binding();
    let core: Record<string, unknown> = { revision: 0n };
    let reservations = 0;
    let locks = 0;
    const client = {
      config: { chainId: 143, core: b.core, apiBase: "https://invalid.example", wallet: { getChainId: async () => 143 } },
      signer: { address: () => b.borrower },
      rpc: {
        creditDetails: async () => core,
        read: async (_address: string, _abi: unknown, fn: string) => {
          if (fn === "asset") return address("c");
          if (fn === "collateralSourceChainOf") return 1n;
          if (fn === "collateralOwnerOf") return b.owner.accountBytes;
          if (fn === "remoteRecoveryVaultOf") return address("e");
          if (fn === "collateralProven") return false;
          throw new Error(`unexpected-read:${fn}`);
        },
        coreWrite: async (fn: string) => {
          if (fn !== "acceptQuote") throw new Error(`unexpected-write:${fn}`);
          reservations += 1;
          core = {
            revision: 2n, facility: 1, borrower: b.borrower, house: b.house, termsHash: b.termsHash,
            collateralVault: b.sourceVault.accountBytes, collateralAsset: b.asset.assetBytes,
            collateralAmount: b.amount, returnRecipient: b.returnRecipient.accountBytes,
            collateralBound: false, account: address("0"), lockId: hash("0"),
          };
          return hash("a");
        },
        wait: async () => ({ status: "success" }),
      },
    } as unknown as TermbookClient;
    const intent = new Intent(client, {
      collateral: { chainId: 1, asset: b.asset.assetBytes as `0x${string}`, amount: b.amount, owner: b.owner.accountBytes, recipient: b.returnRecipient.accountBytes },
      credit: { limit: 100n, duration: 3600 },
    });
    intent.offers = async () => [{
      id: "offer-1", intentId: b.intentId, borrower: b.borrower, owner: b.owner.accountBytes,
      house: b.house, vault: address("b"), sourceChain: 1, collateralVault: b.sourceVault.accountBytes,
      collateralAsset: b.asset.assetBytes as `0x${string}`, collateralAmount: b.amount,
      returnRecipient: b.returnRecipient.accountBytes, settlementAsset: address("c"),
      limit: 100n, aprBps: 500, originationFee: 0n, commitmentFeeBps: 0,
      expiry: 9999999998, maturity: 10000000000, setupDeadline: b.setupDeadline, grace: 0,
      reservationBond: 0n, nonce: b.nonce, bundleId: hash("d"), termsHash: b.termsHash,
      signature: `0x${"e".repeat(130)}` as `0x${string}`, revolving: false,
    }];
    const preflight = vi.spyOn(EvmSourceLockWallet.prototype, "preflight").mockResolvedValue();
    const remoteRecoveryVault = vi.spyOn(EvmSourceLockWallet.prototype, "remoteRecoveryVault").mockResolvedValue(address("e"));
    const observe = vi.spyOn(EvmSourceLockWallet.prototype, "observeLock").mockImplementation(async () => ({ state: locks === 0 ? "missing" : "submitted", txId: locks ? hash("f") : undefined }));
    const submit = vi.spyOn(EvmSourceLockWallet.prototype, "submitLock").mockImplementation(async () => {
      locks += 1;
      return { txId: hash("f") };
    });
    try {
      const accepted = await intent.accept({
        offer_id: "offer-1",
        source_wallet: { chainId: 1, rpcUrl: "https://invalid.example", wallet: { address: b.owner.accountBytes, signTypedData: async () => hash("a") }, vault: b.sourceVault.accountBytes, asset: b.asset.assetBytes as `0x${string}`, controller: address("d") },
      });
      expect(accepted.id).toBe(keccak256(encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
        [b.intentId, b.borrower, b.house, b.nonce],
      )));
      expect(accepted.setup?.snapshot().stage).toBe("awaiting_finality");
      expect(reservations).toBe(1);
      expect(locks).toBe(1);
    } finally {
      preflight.mockRestore();
      remoteRecoveryVault.mockRestore();
      observe.mockRestore();
      submit.mockRestore();
    }
  });
});
