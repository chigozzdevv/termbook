import {
  collateralSetupBindingSchema,
  collateralSetupCheckpointSchema,
  type CollateralAccount,
  type CollateralSetupBinding,
  type CollateralSetupCheckpoint,
  type CollateralSetupStage,
} from "@termbook/schema";
import { accountFactoryAbi, termbookCoreAbi } from "@termbook/bindings";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import type { TermbookClient } from "../client/client.js";
import type { TxHash } from "../types/client.types.js";
import { Credit } from "../credit/credit.js";
import { solanaAlias } from "./solana.js";

export type SourceLockObservation = { state: "missing" | "submitted" | "finalized" | "failed"; txId?: string };

export type SourceLockWallet = {
  account: CollateralAccount;
  preflight?: (binding: CollateralSetupBinding) => Promise<void>;
  remoteRecoveryVault?: (binding: CollateralSetupBinding) => Promise<`0x${string}`>;
  lockPda?: (binding: CollateralSetupBinding, lockId: TxHash) => Promise<`0x${string}`>;
  observeLock: (binding: CollateralSetupBinding, lockId: TxHash, txId?: string) => Promise<SourceLockObservation>;
  submitLock: (binding: CollateralSetupBinding, lockId: TxHash, revision: bigint,
    wormhole?: { actionHash: TxHash; authorizationTxHash?: TxHash }) => Promise<{ txId: string }>;
  submitAction?: (plan: unknown) => Promise<{ txId: string }>;
};

export type CollateralProofSource = {
  getProof: (binding: CollateralSetupBinding, lockId: TxHash) => Promise<{ header: TxHash; proof: TxHash } | null>;
};

export type CollateralSetupOptions = {
  sourceWallet?: SourceLockWallet;
  proofSource?: CollateralProofSource;
  reserve?: () => Promise<TxHash>;
  checkpoint?: CollateralSetupCheckpoint;
  onProgress?: (checkpoint: CollateralSetupCheckpoint, binding: CollateralSetupBinding) => void | Promise<void>;
};

export class CollateralChainNotIntegratedError extends Error {
  constructor(namespace: string) {
    super(`collateral-chain-not-integrated:${namespace}`);
    this.name = "CollateralChainNotIntegratedError";
  }
}

export class CollateralSetupInterruptedError extends Error {
  readonly setup: CollateralSetup;

  constructor(setup: CollateralSetup, cause: unknown) {
    super("collateral-setup-interrupted", { cause });
    this.name = "CollateralSetupInterruptedError";
    this.setup = setup;
  }
}

function field(value: Record<string, unknown>, key: string, index: number): unknown {
  return Array.isArray(value) ? value[index] : value[key];
}

function equalHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function solanaAliasOrRaw(genesis: `0x${string}` | undefined, id: `0x${string}`): `0x${string}` {
  return genesis ? solanaAlias(genesis, id) : id;
}

function accountHash(account: CollateralAccount): TxHash {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "bytes" }],
    [account.namespace, account.reference, account.accountBytes],
  ));
}

export function collateralSetupHash(value: CollateralSetupBinding): TxHash {
  const binding = collateralSetupBindingSchema.parse(value);
  const assetHash = keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "bytes" }],
    [binding.asset.namespace, binding.asset.reference, binding.asset.kind, binding.asset.assetBytes],
  ));
  if (binding.asset.namespace === "solana") {
    return keccak256(encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "address" },
        { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" },
        { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" },
        { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" },
      ],
      [
        keccak256(stringToHex("TermbookSolanaCollateralSetupV1")), BigInt(binding.monadChainId),
        BigInt(binding.sourceChainId!), binding.core, binding.creditId, binding.intentId,
        binding.termsHash, binding.borrower, binding.house, accountHash(binding.sourceVault),
        assetHash, binding.amount, accountHash(binding.owner), accountHash(binding.returnRecipient),
        accountHash(binding.recoveryVault!), BigInt(binding.setupDeadline), binding.nonce,
        binding.verifierVersion!,
      ],
    ));
  }
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "uint256" }, { type: "uint256" },
    ],
    [
      keccak256(stringToHex("TermbookCollateralSetupV1")), BigInt(binding.monadChainId), binding.core,
      binding.creditId, binding.intentId, binding.termsHash, binding.borrower, binding.house,
      accountHash(binding.sourceVault), assetHash, binding.amount, accountHash(binding.owner),
      accountHash(binding.returnRecipient), BigInt(binding.setupDeadline), binding.nonce,
    ],
  ));
}

export function restoreCollateralSetup(value: string): { binding: CollateralSetupBinding; checkpoint: CollateralSetupCheckpoint } {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new Error("setup-snapshot-invalid");
  }
  if (!raw || typeof raw !== "object" || !("binding" in raw) || !("checkpoint" in raw) || !raw.binding || typeof raw.binding !== "object") throw new Error("setup-snapshot-invalid");
  const encoded = raw.binding as Record<string, unknown>;
  if (typeof encoded["amount"] !== "string" || !/^[1-9][0-9]*$/.test(encoded["amount"]) || typeof encoded["nonce"] !== "string" || !/^[0-9]+$/.test(encoded["nonce"])) throw new Error("setup-snapshot-invalid");
  if (encoded["verifierVersion"] !== undefined && (typeof encoded["verifierVersion"] !== "string" || !/^[1-9][0-9]*$/.test(encoded["verifierVersion"]))) throw new Error("setup-snapshot-invalid");
  const binding = collateralSetupBindingSchema.parse({ ...encoded, amount: BigInt(encoded["amount"]), nonce: BigInt(encoded["nonce"]), verifierVersion: encoded["verifierVersion"] === undefined ? undefined : BigInt(encoded["verifierVersion"]) });
  const checkpoint = collateralSetupCheckpointSchema.parse(raw.checkpoint);
  if (!equalHex(checkpoint.bindingHash, collateralSetupHash(binding)) || !equalHex(checkpoint.creditId, binding.creditId) || !equalHex(checkpoint.termsHash, binding.termsHash)) throw new Error("setup-checkpoint-mismatch");
  return { binding, checkpoint };
}

export class CollateralSetup {
  readonly client: TermbookClient;
  readonly binding: CollateralSetupBinding;
  readonly bindingHash: TxHash;
  readonly credit: Credit;
  readonly options: CollateralSetupOptions;
  private current: CollateralSetupCheckpoint;

  constructor(client: TermbookClient, value: CollateralSetupBinding, options: CollateralSetupOptions = {}) {
    this.binding = collateralSetupBindingSchema.parse(value);
    if (this.binding.monadChainId !== client.config.chainId || !equalHex(this.binding.core, client.config.core) || !equalHex(this.binding.borrower, client.signer.address())) throw new Error("setup-borrower-mismatch");
    this.client = client;
    this.options = options;
    this.bindingHash = collateralSetupHash(this.binding);
    this.credit = new Credit(client, this.binding.creditId);
    if (options.sourceWallet && !this.sameAccount(options.sourceWallet.account, this.binding.owner)) throw new Error("source-wallet-mismatch");
    if (options.checkpoint) {
      const checkpoint = collateralSetupCheckpointSchema.parse(options.checkpoint);
      if (!equalHex(checkpoint.bindingHash, this.bindingHash) || !equalHex(checkpoint.creditId, this.binding.creditId) || !equalHex(checkpoint.termsHash, this.binding.termsHash)) throw new Error("setup-checkpoint-mismatch");
      this.current = checkpoint;
    } else {
      this.current = this.checkpoint("awaiting_borrower");
    }
  }

  snapshot(): CollateralSetupCheckpoint {
    return { ...this.current };
  }

  serialize(): string {
    return JSON.stringify({ binding: { ...this.binding, amount: this.binding.amount.toString(), nonce: this.binding.nonce.toString(), verifierVersion: this.binding.verifierVersion?.toString() }, checkpoint: this.snapshot() });
  }

  private sameAccount(left: CollateralAccount, right: CollateralAccount): boolean {
    return left.namespace === right.namespace && left.reference === right.reference && equalHex(left.accountBytes, right.accountBytes);
  }

  private checkpoint(stage: CollateralSetupStage, values: Partial<CollateralSetupCheckpoint> = {}): CollateralSetupCheckpoint {
    return collateralSetupCheckpointSchema.parse({
      ...this.current,
      ...values,
      version: 1,
      bindingHash: this.bindingHash,
      creditId: this.binding.creditId,
      termsHash: this.binding.termsHash,
      stage,
      updatedAt: Math.floor(Date.now() / 1000),
    });
  }

  private async record(stage: CollateralSetupStage, values: Partial<CollateralSetupCheckpoint> = {}): Promise<void> {
    this.current = this.checkpoint(stage, values);
    await this.options.onProgress?.(this.snapshot(), this.binding);
  }

  private sourceChainId(): number {
    const id = this.binding.asset.namespace === "solana" ? this.binding.sourceChainId : Number(this.binding.asset.reference);
    if (id === undefined || !Number.isSafeInteger(id) || id <= 0) throw new Error("source-chain-invalid");
    return id;
  }

  private async checkBorrowerWallet(): Promise<void> {
    const connected = this.client.config.wallet?.getChainId;
    if (!connected || await connected() !== this.binding.monadChainId) throw new Error("borrower-wallet-chain-mismatch");
  }

  private async coreState(): Promise<{ exists: boolean; facility: number; revision: bigint; bound: boolean; proven: boolean; account: string; lockId: string }> {
    const details = await this.client.rpc.creditDetails(this.binding.creditId);
    const revision = BigInt(String(field(details, "revision", 17) ?? 0));
    if (revision === 0n) return { exists: false, facility: 0, revision, bound: false, proven: false, account: "", lockId: "" };
    const b = this.binding;
    const solana = b.asset.namespace === "solana";
    const genesis = solana ? b.asset.reference as `0x${string}` : undefined;
    const expected: [unknown, string][] = [
      [field(details, "borrower", 2), b.borrower], [field(details, "house", 3), b.house],
      [field(details, "termsHash", 21), b.termsHash],
      [field(details, "collateralVault", 6), solanaAliasOrRaw(genesis, b.sourceVault.accountBytes)],
      [field(details, "collateralAsset", 7), solanaAliasOrRaw(genesis, b.asset.assetBytes)],
      [field(details, "returnRecipient", 8), solanaAliasOrRaw(genesis, b.returnRecipient.accountBytes)],
    ];
    if (expected.some(([actual, wanted]) => typeof actual !== "string" || !equalHex(actual, wanted)) || BigInt(String(field(details, "collateralAmount", 9) ?? 0)) !== b.amount) throw new Error("setup-core-binding-mismatch");
    const sourceChain = await this.client.rpc.read<bigint>(b.core, termbookCoreAbi, "collateralSourceChainOf", [b.creditId]);
    const owner = await this.client.rpc.read<string>(b.core, termbookCoreAbi, "collateralOwnerOf", [b.creditId]);
    if (sourceChain !== BigInt(this.sourceChainId()) || !equalHex(owner, solanaAliasOrRaw(genesis, b.owner.accountBytes))) throw new Error("setup-core-binding-mismatch");
    if (solana) {
      const identity = await this.client.rpc.read<Record<string, unknown>>(b.core, termbookCoreAbi, "solanaIdentityOf", [b.creditId]);
      const fields: [string, string][] = [
        ["sourceGenesis", b.asset.reference], ["programId", b.sourceVault.accountBytes],
        ["sourceAsset", b.asset.assetBytes], ["sourceOwner", b.owner.accountBytes],
        ["returnRecipient", b.returnRecipient.accountBytes], ["recoveryVault", b.recoveryVault!.accountBytes],
      ];
      if (fields.some(([name, wanted], index) => !equalHex(String(field(identity, name, index) ?? ""), wanted))
        || BigInt(String(field(identity, "verifierVersion", 6) ?? 0)) !== b.verifierVersion) throw new Error("setup-solana-identity-mismatch");
      const market = await this.client.rpc.read<Record<string, unknown>>(b.core, termbookCoreAbi, "solanaMarkets", [BigInt(this.sourceChainId())]);
      const programDataHash = field(market, "programDataHash", 2);
      if (!field(market, "active", 4)
        || !equalHex(String(field(market, "sourceGenesis", 0) ?? ""), b.asset.reference)
        || !equalHex(String(field(market, "programId", 1) ?? ""), b.sourceVault.accountBytes)
        || typeof programDataHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(programDataHash)
        || BigInt(programDataHash) === 0n
        || !equalHex(String(field(market, "sourceAsset", 3) ?? ""), b.asset.assetBytes)) throw new Error("setup-solana-market-mismatch");
    }
    const lockId = String(field(details, "lockId", 22) ?? "");
    const bound = Boolean(field(details, "collateralBound", 23));
    if (bound && !equalHex(lockId, this.bindingHash)) throw new Error("setup-lock-mismatch");
    const proven = await this.client.rpc.read<boolean>(b.core, termbookCoreAbi, "collateralProven", [b.creditId]);
    return {
      exists: true,
      facility: Number(field(details, "facility", 0)),
      revision,
      bound,
      proven,
      account: String(field(details, "account", 5) ?? ""),
      lockId,
    };
  }

  async resume(): Promise<CollateralSetupCheckpoint> {
    await this.client.ready();
    const b = this.binding;
    const sourceChain = this.sourceChainId();
    const solana = b.asset.namespace === "solana";
    if (b.sourceVault.namespace !== b.asset.namespace || b.owner.namespace !== b.asset.namespace || b.returnRecipient.namespace !== b.asset.namespace) throw new CollateralChainNotIntegratedError(b.asset.namespace);
    let state = await this.coreState();
    if (this.current.borrowerTx && !state.exists) {
      await this.client.rpc.wait(this.current.borrowerTx);
      state = await this.coreState();
    }
    if (this.current.bindTx && state.exists && !state.bound) {
      await this.client.rpc.wait(this.current.bindTx);
      state = await this.coreState();
    }
    if (this.current.proofTx && state.bound && !state.proven) {
      await this.client.rpc.wait(this.current.proofTx);
      state = await this.coreState();
    }
    if (this.current.accountTx && state.proven && state.facility !== 4) {
      await this.client.rpc.wait(this.current.accountTx);
      state = await this.coreState();
    }
    if (state.facility === 4 && state.exists) {
      await this.record("ready");
      return this.snapshot();
    }
    if (b.setupDeadline <= Math.floor(Date.now() / 1000)) throw new Error("setup-expired");
    await this.checkBorrowerWallet();
    if (this.options.sourceWallet) await this.options.sourceWallet.preflight?.(b);
    await this.options.onProgress?.(this.snapshot(), this.binding);
    if (!state.exists) {
      if (!this.options.reserve) return this.checkpoint("awaiting_borrower");
      if (!this.options.sourceWallet) throw new Error("source-wallet-required");
      const tx = await this.options.reserve();
      await this.record("awaiting_borrower", { borrowerTx: tx });
      await this.client.rpc.wait(tx);
      await this.record("reserved", { borrowerTx: tx });
      state = await this.coreState();
      if (!state.exists) throw new Error("reservation-unconfirmed");
    }
    if (state.facility > 4) throw new Error("setup-state-invalid");
    const wallet = this.options.sourceWallet;
    if (solana && !state.bound) {
      await this.checkBorrowerWallet();
      if (!wallet?.lockPda || !wallet.remoteRecoveryVault) throw new Error("source-wallet-required");
      if (!equalHex(await wallet.remoteRecoveryVault(b), b.recoveryVault!.accountBytes)) {
        throw new Error("source-recovery-vault-mismatch");
      }
      const lockPda = await wallet.lockPda(b, this.bindingHash);
      if (!/^0x[a-fA-F0-9]{64}$/.test(lockPda) || /^0x0{64}$/i.test(lockPda)) {
        throw new Error("source-lock-pda-invalid");
      }
      const fee = await this.client.rpc.solanaWormholeFee();
      const tx = await this.client.rpc.coreWrite("bindSolanaCollateral",
        [b.creditId, this.bindingHash, lockPda], fee);
      await this.record("proof_pending", { bindTx: tx });
      await this.client.rpc.wait(tx);
      state = await this.coreState();
      if (!state.bound) throw new Error("collateral-bind-unconfirmed");
    }
    if (!state.bound || (solana && !state.proven)) {
      if (!wallet) {
        await this.record("awaiting_source_wallet");
        return this.snapshot();
      }
      if (solana) {
        if (!wallet.remoteRecoveryVault || !equalHex(await wallet.remoteRecoveryVault(b), b.recoveryVault!.accountBytes)) throw new Error("source-recovery-vault-mismatch");
        if (!wallet.lockPda) throw new Error("source-lock-pda-unavailable");
      } else if (sourceChain !== b.monadChainId) {
        if (!wallet.remoteRecoveryVault) throw new Error("source-recovery-vault-unavailable");
        const sourceRecovery = await wallet.remoteRecoveryVault(b);
        const pinnedRecovery = await this.client.rpc.read<string>(b.core, termbookCoreAbi, "remoteRecoveryVaultOf", [b.creditId]);
        if (!/^0x[a-fA-F0-9]{40}$/.test(sourceRecovery) || /^0x0{40}$/i.test(sourceRecovery) || !/^0x[a-fA-F0-9]{40}$/.test(pinnedRecovery) || !equalHex(sourceRecovery, pinnedRecovery)) throw new Error("source-recovery-vault-mismatch");
      }
      let lock = await wallet.observeLock(b, this.bindingHash, this.current.sourceTx);
      if (lock.state === "failed") throw new Error("source-lock-failed");
      if (lock.state === "missing" && !this.current.sourceTx) {
        const wormhole = solana ? {
          actionHash: await this.client.rpc.read<TxHash>(b.core, termbookCoreAbi,
            "solanaLockDigest", [b.creditId]),
          authorizationTxHash: this.current.bindTx,
        } : undefined;
        const submitted = await wallet.submitLock(b, this.bindingHash, state.revision, wormhole);
        await this.record("lock_submitted", { sourceTx: submitted.txId, lockId: this.bindingHash });
        lock = await wallet.observeLock(b, this.bindingHash, submitted.txId);
      }
      if (lock.state !== "finalized") {
        await this.record("awaiting_finality", { sourceTx: lock.txId ?? this.current.sourceTx, lockId: this.bindingHash });
        return this.snapshot();
      }
      await this.record("proof_pending", { sourceTx: lock.txId ?? this.current.sourceTx, lockId: this.bindingHash });
      if (!solana) {
        const functionName = sourceChain === b.monadChainId ? "bindCollateral" : "bindRemoteCollateral";
        await this.checkBorrowerWallet();
        const tx = await this.client.rpc.coreWrite(functionName, [b.creditId, this.bindingHash]);
        await this.record("proof_pending", { bindTx: tx });
        await this.client.rpc.wait(tx);
        state = await this.coreState();
        if (!state.bound) throw new Error("collateral-bind-unconfirmed");
      }
    }
    if (!state.proven && sourceChain !== b.monadChainId) {
      if (!this.options.proofSource) {
        if (solana && this.current.sourceTx && this.client.config.apiBase && wallet?.lockPda) {
          await this.client.authenticatedPost("/collateral/solana", {
            creditId: b.creditId, lockId: this.bindingHash,
            lockPda: await wallet.lockPda(b, this.bindingHash), sourceTx: this.current.sourceTx,
          });
          state = await this.coreState();
        }
        if (!state.proven) {
          await this.record("proof_pending");
          return this.snapshot();
        }
      } else {
        const proof = await this.options.proofSource.getProof(b, this.bindingHash);
        if (!proof) {
          await this.record("proof_pending");
          return this.snapshot();
        }
        await this.checkBorrowerWallet();
        const tx = solana
          ? await this.client.rpc.coreWrite("proveSolanaCollateral", [b.creditId, proof.header, proof.proof])
          : await this.client.rpc.coreWrite("proveCollateral", [b.creditId, BigInt(sourceChain), proof.header, proof.proof]);
        await this.record("proof_submitted", { proofTx: tx });
        await this.client.rpc.wait(tx);
        state = await this.coreState();
        if (!state.proven) throw new Error("collateral-proof-unconfirmed");
      }
    }
    if (!state.proven) {
      await this.record("proof_pending");
      return this.snapshot();
    }
    if (!this.client.config.accountFactory) {
      await this.record("account_pending");
      return this.snapshot();
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(state.account) || /^0x0{40}$/i.test(state.account)) {
      const factory = this.client.config.accountFactory;
      let account = await this.client.rpc.read<`0x${string}`>(factory, accountFactoryAbi, "accountOf", [b.creditId]);
      if (/^0x0{40}$/i.test(account)) {
        await this.checkBorrowerWallet();
        const createTx = await this.client.rpc.write(factory, accountFactoryAbi, "create", [b.creditId, b.borrower, b.core]);
        await this.record("account_pending", { accountTx: createTx });
        await this.client.rpc.wait(createTx);
        account = await this.client.rpc.read<`0x${string}`>(factory, accountFactoryAbi, "accountOf", [b.creditId]);
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(account) || /^0x0{40}$/i.test(account)) throw new Error("account-create-unconfirmed");
      await this.checkBorrowerWallet();
      const bindTx = await this.client.rpc.coreWrite("bindAccount", [b.creditId, account]);
      await this.record("account_pending", { accountTx: bindTx });
      await this.client.rpc.wait(bindTx);
    }
    state = await this.coreState();
    if (state.facility !== 4) {
      await this.record("account_pending");
      return this.snapshot();
    }
    await this.record("ready");
    return this.snapshot();
  }
}
