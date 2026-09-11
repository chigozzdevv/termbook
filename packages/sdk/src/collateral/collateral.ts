import type { TermbookClient } from "../client/client.js";
import type { CollateralArgs } from "../types/collateral.types.js";
import type { TxHash } from "../types/client.types.js";
import { encodeAbiParameters, keccak256 } from "viem";
import { collateralVaultAbi } from "@termbook/bindings";

function detail(details: Record<string, unknown>, key: string, index: number): unknown {
  return Array.isArray(details) ? details[index] : details[key];
}

export class CreditCollateral {
  client: TermbookClient;
  creditId: `0x${string}`;

  constructor(client: TermbookClient, creditId: `0x${string}`) {
    this.client = client;
    this.creditId = creditId;
  }

  async add(args: CollateralArgs): Promise<{ lockId: `0x${string}`; tx: TxHash }> {
    if (args.amount <= 0n) throw new Error("param-invalid");
    const details = await this.client.rpc.creditDetails(this.creditId);
    const detailVault = detail(details, "collateralVault", 6);
    const detailAsset = detail(details, "collateralAsset", 7);
    const configuredVault = this.client.config.collateralVault;
    const vault = (typeof detailVault === "string" && /^0x[a-fA-F0-9]{40}$/.test(detailVault) ? detailVault : configuredVault) as `0x${string}` | undefined;
    const asset = args.asset ?? (typeof detailAsset === "string" && /^0x[a-fA-F0-9]{40}$/.test(detailAsset) ? detailAsset as `0x${string}` : undefined);
    if (!vault || !asset) throw new Error("collateral-config-required");
    const owner = args.owner ?? this.client.signer.address();
    const recipient = args.recipient ?? this.client.signer.address();
    const sourceChain = args.sourceChain ?? (await this.client.rpc.read<bigint>(vault, collateralVaultAbi, "chainId_").catch(() => 0n));
    const sourceChainValue = typeof sourceChain === "bigint" ? Number(sourceChain) : sourceChain;
    if (!Number.isSafeInteger(sourceChainValue) || sourceChainValue <= 0) throw new Error("collateral-chain-required");
    const existingAmount = BigInt(String(detail(details, "collateralAmount", 9) ?? 0));
    if (existingAmount > 0n && existingAmount !== args.amount) throw new Error("collateral-amount-mismatch");
    if (typeof detailAsset === "string" && detailAsset.toLowerCase() !== asset.toLowerCase()) throw new Error("collateral-asset-mismatch");
    if (sourceChainValue !== this.client.config.chainId) {
      if (typeof args.lockId !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(args.lockId) || typeof args.header !== "string" || typeof args.proof !== "string") throw new Error("collateral-proof-required");
      const facility = await this.client.rpc.facility(this.creditId);
      let tx: TxHash;
      if (facility === 0) {
        tx = await this.client.rpc.coreWrite("setRemoteCollateral", [this.creditId, BigInt(sourceChainValue), vault, asset, args.amount, owner, recipient]);
        await this.client.rpc.wait(tx);
      } else if (facility !== 1 && facility !== 2) {
        throw new Error("collateral-state-invalid");
      }
      if (facility === 0 || facility === 1) {
        tx = await this.client.rpc.coreWrite("bindRemoteCollateral", [this.creditId, args.lockId]);
        await this.client.rpc.wait(tx);
      }
      tx = await this.client.rpc.coreWrite("proveCollateral", [this.creditId, BigInt(sourceChainValue), args.header, args.proof]);
      await this.client.rpc.wait(tx);
      return { lockId: args.lockId, tx };
    }
    if (owner.toLowerCase() !== this.client.signer.address().toLowerCase()) throw new Error("collateral-owner-wallet-required");
    const configuredAsset = await this.client.rpc.read<`0x${string}`>(vault, collateralVaultAbi, "asset");
    if (configuredAsset.toLowerCase() !== asset.toLowerCase()) throw new Error("collateral-asset-mismatch");
    const deadline = args.deadline ?? Math.floor(Date.now() / 1000) + 3600;
    const nonce = args.nonce ?? 0n;
    const lockId = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [this.creditId, owner, asset, args.amount, nonce],
    ));
    const approvalTx = await this.client.rpc.approve(asset, vault, args.amount);
    await this.client.rpc.wait(approvalTx);
    const facility = await this.client.rpc.facility(this.creditId);
    if (facility === 0) {
      const bindTx = await this.client.rpc.coreWrite("setCollateralWithOwner", [this.creditId, vault, owner, recipient]);
      await this.client.rpc.wait(bindTx);
    } else if (facility !== 1) {
      throw new Error("collateral-state-invalid");
    }
    const revision = await this.client.rpc.revision(this.creditId);
    const lockTx = await this.client.rpc.write(vault, collateralVaultAbi, "lockWithDeadline", [lockId, this.creditId, owner, args.amount, recipient, BigInt(deadline), revision]);
    await this.client.rpc.wait(lockTx);
    const tx = await this.client.rpc.coreWrite("bindCollateral", [this.creditId, lockId]);
    await this.client.rpc.wait(tx);
    return { lockId, tx };
  }

  async withdraw(args: CollateralArgs): Promise<{ pending: boolean; tx?: TxHash }> {
    const details = await this.client.rpc.creditDetails(this.creditId);
    const lock = detail(details, "lockId", 22);
    const amount = detail(details, "collateralAmount", 9);
    if (typeof lock !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(lock)) throw new Error("collateral-unavailable");
    const requested = args.amount > 0n ? args.amount : BigInt(String(amount ?? 0));
    if (requested <= 0n) throw new Error("param-invalid");
    const tx = await this.client.rpc.coreWrite("withdrawCollateral", [this.creditId, requested]);
    await this.client.rpc.wait(tx);
    return { pending: false, tx };
  }

  async balance(): Promise<bigint> {
    const details = await this.client.rpc.creditDetails(this.creditId);
    const amount = BigInt(String(detail(details, "collateralAmount", 9) ?? 0));
    const returned = Boolean(detail(details, "collateralReturned", 24));
    return returned ? 0n : amount;
  }
}
