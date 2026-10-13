import { evmActionAbi, parseEvmActionPlan } from "./evm-action.js";
import { collateralVaultAbi } from "@termbook/bindings";
import { createPublicClient, encodeAbiParameters, http, keccak256 } from "viem";
import { collateralSetupBindingSchema, type CollateralSetupBinding } from "@termbook/schema";
import type { ContractWriteRequest, TxHash, Wallet } from "../types/client.types.js";
import { collateralSetupHash, type SourceLockObservation, type SourceLockWallet } from "./setup.js";

const erc20Abi = [
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "deposit", inputs: [], outputs: [], stateMutability: "payable" },
] as const;

const nativeVaultAbi = [{
  type: "function",
  name: "lockNativeWithDeadline",
  inputs: [
    { name: "lockId", type: "bytes32" }, { name: "creditId", type: "bytes32" },
    { name: "owner", type: "address" }, { name: "amount", type: "uint256" },
    { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" },
    { name: "revision", type: "uint256" },
  ],
  outputs: [],
  stateMutability: "payable",
}] as const;

const vaultIdentityAbi = [{
  type: "function", name: "isNativeCollateralVault", inputs: [],
  outputs: [{ type: "bool" }], stateMutability: "pure",
}] as const;

const remoteControllerAbi = [
  { type: "function", name: "recoveryVault", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "monadChain", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "monadCore", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

const recoveryVaultAbi = [
  { type: "function", name: "controller", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "monadChain", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const;

const remoteVaultAbi = [
  {
    type: "function", name: "lockRemoteWithDeadline",
    inputs: [
      { name: "lockId", type: "bytes32" }, { name: "creditId", type: "bytes32" },
      { name: "borrower", type: "address" }, { name: "owner", type: "address" },
      { name: "amount", type: "uint256" }, { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" }, { name: "revision", type: "uint256" },
    ],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "lockCommitments", inputs: [{ name: "lockId", type: "bytes32" }],
    outputs: [{ type: "bytes32" }], stateMutability: "view",
  },
] as const;

export function evmRemoteLockCommitment(binding: CollateralSetupBinding, lockId: TxHash, recoveryVault: `0x${string}`): TxHash {
  collateralSetupBindingSchema.parse(binding);
  if (binding.asset.namespace !== "eip155" || binding.sourceVault.namespace !== "eip155" || binding.owner.namespace !== "eip155" || binding.returnRecipient.namespace !== "eip155" || binding.asset.reference === String(binding.monadChainId)) throw new Error("remote-collateral-chain-invalid");
  if (!/^0x[a-fA-F0-9]{40}$/.test(recoveryVault) || /^0x0{40}$/i.test(recoveryVault)) throw new Error("source-recovery-vault-invalid");
  if (collateralSetupHash(binding).toLowerCase() !== lockId.toLowerCase()) throw new Error("source-lock-id-mismatch");
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
      { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" },
      { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" },
    ],
    [
      binding.creditId, lockId, binding.borrower, binding.owner.accountBytes, binding.sourceVault.accountBytes,
      binding.asset.assetBytes, binding.amount, BigInt(binding.asset.reference), binding.returnRecipient.accountBytes,
      recoveryVault, BigInt(binding.monadChainId), binding.core,
    ],
  ));
}

export function evmSourceLockCall(binding: CollateralSetupBinding, lockId: TxHash, revision: bigint, nativeVault = false): { functionName: "lockWithDeadline" | "lockNativeWithDeadline" | "lockRemoteWithDeadline"; args: readonly unknown[]; value?: bigint } {
  collateralSetupBindingSchema.parse(binding);
  if (binding.asset.namespace !== "eip155" || binding.owner.namespace !== "eip155" || binding.returnRecipient.namespace !== "eip155") throw new Error("source-chain-invalid");
  if (collateralSetupHash(binding).toLowerCase() !== lockId.toLowerCase() || revision <= 0n) throw new Error("source-lock-id-mismatch");
  if (binding.asset.reference !== String(binding.monadChainId)) {
    if (nativeVault) throw new Error("remote-native-vault-unavailable");
    return { functionName: "lockRemoteWithDeadline", args: [lockId, binding.creditId, binding.borrower, binding.owner.accountBytes, binding.amount, binding.returnRecipient.accountBytes, BigInt(binding.setupDeadline), revision] };
  }
  const args = [lockId, binding.creditId, binding.owner.accountBytes, binding.amount, binding.returnRecipient.accountBytes, BigInt(binding.setupDeadline), revision] as const;
  return nativeVault ? { functionName: "lockNativeWithDeadline", args, value: binding.amount } : { functionName: "lockWithDeadline", args };
}

export type EvmSourceWalletConfig = {
  chainId: number;
  rpcUrl: string;
  wallet: Wallet;
  vault: `0x${string}`;
  asset: `0x${string}`;
  controller: `0x${string}`;
  wrapNative?: boolean;
  nativeVault?: boolean;
  confirmations?: number;
  testnetConfirmations?: number;
  testnetFinality?: "safe";
};

export class EvmSourceLockWallet implements SourceLockWallet {
  readonly account: { namespace: "eip155"; reference: string; accountBytes: `0x${string}` };
  readonly config: EvmSourceWalletConfig;
  private readonly rpc;

  constructor(config: EvmSourceWalletConfig) {
    if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0 || !/^0x[a-fA-F0-9]{40}$/.test(config.wallet.address) || !/^0x[a-fA-F0-9]{40}$/.test(config.vault) || !/^0x[a-fA-F0-9]{40}$/.test(config.asset) || !/^0x[a-fA-F0-9]{40}$/.test(config.controller) || (config.nativeVault && config.wrapNative)) throw new Error("source-wallet-config-invalid");
    this.config = config;
    this.account = { namespace: "eip155", reference: String(config.chainId), accountBytes: config.wallet.address };
    this.rpc = createPublicClient({ transport: http(config.rpcUrl) });
  }

  private async checkChain(binding: CollateralSetupBinding, requireWallet = true): Promise<`0x${string}` | undefined> {
    collateralSetupBindingSchema.parse(binding);
    if (binding.asset.namespace !== "eip155" || binding.sourceVault.namespace !== "eip155" || binding.owner.namespace !== "eip155" || binding.returnRecipient.namespace !== "eip155" || binding.asset.reference !== String(this.config.chainId) || binding.sourceVault.accountBytes.toLowerCase() !== this.config.vault.toLowerCase() || binding.asset.assetBytes.toLowerCase() !== this.config.asset.toLowerCase() || binding.owner.accountBytes.toLowerCase() !== this.config.wallet.address.toLowerCase()) throw new Error("source-wallet-binding-mismatch");
    if (await this.rpc.getChainId() !== this.config.chainId || requireWallet
      && (!this.config.wallet.getChainId || await this.config.wallet.getChainId() !== this.config.chainId)) throw new Error("source-wallet-chain-mismatch");
    let nativeVault: boolean;
    try {
      nativeVault = await this.rpc.readContract({ address: this.config.vault, abi: vaultIdentityAbi, functionName: "isNativeCollateralVault", blockTag: "finalized" });
    } catch {
      throw new Error("source-vault-kind-unverified");
    }
    if (nativeVault !== Boolean(this.config.nativeVault)) throw new Error(nativeVault ? "source-vault-native-required" : "source-vault-not-native");
    if (nativeVault && this.config.chainId !== binding.monadChainId) throw new Error("remote-native-vault-unavailable");
    const [asset, controller, declaredChain] = await Promise.all([
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "asset", blockTag: "finalized" }),
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "core", blockTag: "finalized" }),
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "chainId_", blockTag: "finalized" }),
    ]);
    if (asset.toLowerCase() !== this.config.asset.toLowerCase() || controller.toLowerCase() !== this.config.controller.toLowerCase() || declaredChain !== BigInt(this.config.chainId)) throw new Error("source-vault-mismatch");
    if (this.config.chainId === binding.monadChainId) return undefined;
    let recoveryVault: `0x${string}`;
    let monadChain: bigint;
    let monadCore: `0x${string}`;
    let recoveryController: `0x${string}`;
    let recoveryAsset: `0x${string}`;
    let recoveryMonadChain: bigint;
    try {
      [recoveryVault, monadChain, monadCore] = await Promise.all([
        this.rpc.readContract({ address: this.config.controller, abi: remoteControllerAbi, functionName: "recoveryVault", blockTag: "finalized" }),
        this.rpc.readContract({ address: this.config.controller, abi: remoteControllerAbi, functionName: "monadChain", blockTag: "finalized" }),
        this.rpc.readContract({ address: this.config.controller, abi: remoteControllerAbi, functionName: "monadCore", blockTag: "finalized" }),
      ]);
      if (/^0x0{40}$/i.test(recoveryVault)) throw new Error("source-recovery-vault-mismatch");
      [recoveryController, recoveryAsset, recoveryMonadChain] = await Promise.all([
        this.rpc.readContract({ address: recoveryVault, abi: recoveryVaultAbi, functionName: "controller", blockTag: "finalized" }),
        this.rpc.readContract({ address: recoveryVault, abi: recoveryVaultAbi, functionName: "asset", blockTag: "finalized" }),
        this.rpc.readContract({ address: recoveryVault, abi: recoveryVaultAbi, functionName: "monadChain", blockTag: "finalized" }),
      ]);
    } catch {
      throw new Error("source-recovery-vault-unverified");
    }
    if (monadChain !== BigInt(binding.monadChainId) || monadCore.toLowerCase() !== binding.core.toLowerCase()) throw new Error("source-controller-mismatch");
    if (recoveryController.toLowerCase() !== this.config.controller.toLowerCase() || recoveryAsset.toLowerCase() !== this.config.asset.toLowerCase() || recoveryMonadChain !== BigInt(binding.monadChainId)) throw new Error("source-recovery-vault-mismatch");
    return recoveryVault;
  }

  async preflight(binding: CollateralSetupBinding): Promise<void> {
    await this.checkChain(binding);
  }

  async remoteRecoveryVault(binding: CollateralSetupBinding): Promise<`0x${string}`> {
    const recoveryVault = await this.checkChain(binding, false);
    if (!recoveryVault) throw new Error("source-recovery-vault-unavailable");
    return recoveryVault;
  }

  private async write(address: `0x${string}`, abi: readonly unknown[], functionName: string, args: readonly unknown[] = [], value?: bigint, waitReceipt = true): Promise<TxHash> {
    if (!this.config.wallet.writeContract) throw new Error("source-wallet-write-unavailable");
    if (!this.config.wallet.getChainId || await this.config.wallet.getChainId() !== this.config.chainId) throw new Error("source-wallet-chain-mismatch");
    const request: ContractWriteRequest = { address, abi, functionName, args, account: this.config.wallet.address };
    if (value !== undefined) request.value = value;
    const tx = await this.config.wallet.writeContract(request);
    if (!waitReceipt) return tx;
    const confirmations = this.config.confirmations ?? 1;
    if (!Number.isSafeInteger(confirmations) || confirmations < 1) throw new Error("confirmations-invalid");
    const receipt = await this.rpc.waitForTransactionReceipt({ hash: tx, confirmations });
    if (receipt.status !== "success") throw new Error("source-transaction-reverted");
    return tx;
  }

  async observeLock(binding: CollateralSetupBinding, lockId: TxHash, txId?: string): Promise<SourceLockObservation> {
    if (collateralSetupHash(binding).toLowerCase() !== lockId.toLowerCase()) throw new Error("source-lock-id-mismatch");
    const depth = this.config.testnetConfirmations;
    const safe = this.config.testnetFinality;
    if (safe !== undefined && (safe !== "safe" || binding.monadChainId !== 10143 || this.config.chainId !== 84532
      || depth !== undefined)) throw new Error("testnet-finality-invalid");
    if (depth !== undefined && (binding.monadChainId !== 10143 || this.config.chainId !== 11155111
      || !Number.isInteger(depth) || depth < 5 || depth > 64)) throw new Error("testnet-confirmations-invalid");
    const recoveryVault = await this.checkChain(binding, false);
    const latest = depth === undefined ? undefined : await this.rpc.getBlock({ blockTag: "latest" });
    if (latest && latest.number < BigInt(depth!)) return { state: "submitted", txId };
    const at = latest ? { blockNumber: latest.number - BigInt(depth!) } : { blockTag: safe ?? "finalized" as const };
    const info = await this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "lockInfo", args: [lockId], ...at });
    if (info[8]) {
      if (info[0].toLowerCase() !== binding.creditId.toLowerCase() || info[1].toLowerCase() !== binding.owner.accountBytes.toLowerCase() || info[2].toLowerCase() !== this.config.asset.toLowerCase() || info[3] !== BigInt(this.config.chainId) || info[4] !== binding.amount || info[5].toLowerCase() !== binding.returnRecipient.accountBytes.toLowerCase() || info[6] !== BigInt(binding.setupDeadline) || info[7] === 0n || info[9] || info[10]) throw new Error("source-lock-binding-mismatch");
      if (this.config.chainId !== binding.monadChainId) {
        const commitment = await this.rpc.readContract({ address: this.config.vault, abi: remoteVaultAbi, functionName: "lockCommitments", args: [lockId], ...at });
        if (!recoveryVault || commitment.toLowerCase() !== evmRemoteLockCommitment(binding, lockId, recoveryVault).toLowerCase()) throw new Error("source-lock-commitment-mismatch");
      }
      return { state: depth === undefined && safe === undefined ? "finalized" : "confirmed", txId };
    }
    if (!txId) return { state: "missing" };
    if (!/^0x[a-fA-F0-9]{64}$/.test(txId)) throw new Error("source-tx-invalid");
    try {
      const receipt = await this.rpc.getTransactionReceipt({ hash: txId as TxHash });
      return { state: receipt.status === "reverted" ? "failed" : "submitted", txId };
    } catch {
      return { state: "submitted", txId };
    }
  }

  async submitAction(value: unknown): Promise<{ txId: string }> {
    const { action, header, proof, controller, actionHash } = parseEvmActionPlan(value);
    if (await this.rpc.getChainId() !== this.config.chainId || !this.config.wallet.getChainId
      || await this.config.wallet.getChainId() !== this.config.chainId || action.sourceChain !== BigInt(this.config.chainId)
      || action.sourceVault.toLowerCase() !== this.config.vault.toLowerCase()
      || action.asset.toLowerCase() !== this.config.asset.toLowerCase()
      || controller.toLowerCase() !== this.config.controller.toLowerCase()
      || action.recipient.toLowerCase() !== this.account.accountBytes.toLowerCase()) throw new Error("source-action-binding-mismatch");
    const [vaultCore, asset, chainId, monadCore, monadChain, info] = await Promise.all([
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "core", blockTag: "finalized" }),
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "asset", blockTag: "finalized" }),
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "chainId_", blockTag: "finalized" }),
      this.rpc.readContract({ address: controller, abi: remoteControllerAbi, functionName: "monadCore", blockTag: "finalized" }),
      this.rpc.readContract({ address: controller, abi: remoteControllerAbi, functionName: "monadChain", blockTag: "finalized" }),
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "lockInfo", args: [action.lockId], blockTag: "finalized" }),
    ]);
    if (vaultCore.toLowerCase() !== controller.toLowerCase() || asset.toLowerCase() !== action.asset.toLowerCase()
      || chainId !== action.sourceChain || monadCore.toLowerCase() !== action.monadCore.toLowerCase() || monadChain !== action.monadChain
      || !info[8] || info[9] || info[10] || info[0].toLowerCase() !== action.creditId.toLowerCase()
      || info[1].toLowerCase() !== action.recipient.toLowerCase()) throw new Error("source-action-binding-mismatch");
    if (await this.rpc.readContract({ address: controller, abi: evmActionAbi, functionName: "consumed", args: [actionHash] })) throw new Error("source-action-already-applied");
    if (action.deadline <= BigInt(Math.floor(Date.now() / 1000) + 120)) throw new Error("source-action-expired");
    let balance = await this.rpc.readContract({ address: action.asset, abi: erc20Abi, functionName: "balanceOf", args: [action.recipient] });
    if (balance < action.amount && this.config.wrapNative) {
      await this.write(action.asset, erc20Abi, "deposit", [], action.amount - balance);
      balance = await this.rpc.readContract({ address: action.asset, abi: erc20Abi, functionName: "balanceOf", args: [action.recipient] });
    }
    if (balance < action.amount) throw new Error("source-collateral-balance-insufficient");
    const allowance = await this.rpc.readContract({ address: action.asset, abi: erc20Abi, functionName: "allowance", args: [action.recipient, action.sourceVault] });
    if (allowance < action.amount) await this.write(action.asset, erc20Abi, "approve", [action.sourceVault, action.amount]);
    return { txId: await this.write(controller, evmActionAbi, "execute", [action, header, proof], undefined, false) };
  }

  async submitLock(binding: CollateralSetupBinding, lockId: TxHash, revision: bigint): Promise<{ txId: string }> {
    if (collateralSetupHash(binding).toLowerCase() !== lockId.toLowerCase()) throw new Error("source-lock-id-mismatch");
    await this.checkChain(binding);
    if (binding.setupDeadline <= Math.floor(Date.now() / 1000) || revision <= 0n) throw new Error("setup-expired");
    if ((await this.observeLock(binding, lockId)).state !== "missing") throw new Error("source-lock-exists");
    const call = evmSourceLockCall(binding, lockId, revision, this.config.nativeVault);
    if (this.config.nativeVault) {
      const tx = await this.write(this.config.vault, nativeVaultAbi, call.functionName, call.args, call.value, false);
      return { txId: tx };
    }
    const owner = this.config.wallet.address;
    let balance = await this.rpc.readContract({ address: this.config.asset, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
    if (balance < binding.amount && this.config.wrapNative) {
      await this.write(this.config.asset, erc20Abi, "deposit", [], binding.amount - balance);
      balance = await this.rpc.readContract({ address: this.config.asset, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
    }
    if (balance < binding.amount) throw new Error("source-collateral-balance-insufficient");
    const allowance = await this.rpc.readContract({ address: this.config.asset, abi: erc20Abi, functionName: "allowance", args: [owner, this.config.vault] });
    if (allowance < binding.amount) await this.write(this.config.asset, erc20Abi, "approve", [this.config.vault, binding.amount]);
    const tx = await this.write(this.config.vault, call.functionName === "lockRemoteWithDeadline" ? remoteVaultAbi : collateralVaultAbi, call.functionName, call.args, undefined, false);
    return { txId: tx };
  }
}
