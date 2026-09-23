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

export function evmRemoteLockCommitment(binding: CollateralSetupBinding, lockId: TxHash): TxHash {
  collateralSetupBindingSchema.parse(binding);
  if (binding.asset.namespace !== "eip155" || binding.sourceVault.namespace !== "eip155" || binding.owner.namespace !== "eip155" || binding.returnRecipient.namespace !== "eip155" || binding.asset.reference === String(binding.monadChainId)) throw new Error("remote-collateral-chain-invalid");
  if (collateralSetupHash(binding).toLowerCase() !== lockId.toLowerCase()) throw new Error("source-lock-id-mismatch");
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
      { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" },
      { type: "address" },
    ],
    [
      binding.creditId, lockId, binding.borrower, binding.owner.accountBytes, binding.sourceVault.accountBytes,
      binding.asset.assetBytes, binding.amount, BigInt(binding.asset.reference), binding.returnRecipient.accountBytes,
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

  private async checkChain(binding: CollateralSetupBinding): Promise<void> {
    collateralSetupBindingSchema.parse(binding);
    if (binding.asset.namespace !== "eip155" || binding.sourceVault.namespace !== "eip155" || binding.owner.namespace !== "eip155" || binding.returnRecipient.namespace !== "eip155" || binding.asset.reference !== String(this.config.chainId) || binding.sourceVault.accountBytes.toLowerCase() !== this.config.vault.toLowerCase() || binding.asset.assetBytes.toLowerCase() !== this.config.asset.toLowerCase() || binding.owner.accountBytes.toLowerCase() !== this.config.wallet.address.toLowerCase()) throw new Error("source-wallet-binding-mismatch");
    if (await this.rpc.getChainId() !== this.config.chainId || !this.config.wallet.getChainId || await this.config.wallet.getChainId() !== this.config.chainId) throw new Error("source-wallet-chain-mismatch");
    const [asset, controller, declaredChain] = await Promise.all([
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "asset", blockTag: "finalized" }),
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "core", blockTag: "finalized" }),
      this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "chainId_", blockTag: "finalized" }),
    ]);
    if (asset.toLowerCase() !== this.config.asset.toLowerCase() || controller.toLowerCase() !== this.config.controller.toLowerCase() || declaredChain !== BigInt(this.config.chainId)) throw new Error("source-vault-mismatch");
  }

  async preflight(binding: CollateralSetupBinding): Promise<void> {
    await this.checkChain(binding);
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
    await this.checkChain(binding);
    const info = await this.rpc.readContract({ address: this.config.vault, abi: collateralVaultAbi, functionName: "lockInfo", args: [lockId], blockTag: "finalized" });
    if (info[8]) {
      if (info[0].toLowerCase() !== binding.creditId.toLowerCase() || info[1].toLowerCase() !== binding.owner.accountBytes.toLowerCase() || info[2].toLowerCase() !== this.config.asset.toLowerCase() || info[3] !== BigInt(this.config.chainId) || info[4] !== binding.amount || info[5].toLowerCase() !== binding.returnRecipient.accountBytes.toLowerCase() || info[6] !== BigInt(binding.setupDeadline) || info[7] === 0n || info[9] || info[10]) throw new Error("source-lock-binding-mismatch");
      if (this.config.chainId !== binding.monadChainId) {
        const commitment = await this.rpc.readContract({ address: this.config.vault, abi: remoteVaultAbi, functionName: "lockCommitments", args: [lockId], blockTag: "finalized" });
        if (commitment.toLowerCase() !== evmRemoteLockCommitment(binding, lockId).toLowerCase()) throw new Error("source-lock-commitment-mismatch");
      }
      return { state: "finalized", txId };
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
