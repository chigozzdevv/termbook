import { isEvmSource } from "../chain/networks.js";
import { termbookCoreAbi } from "@termbook/bindings";
import { encodeAbiParameters, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";

const coreAbi = parseAbi([
  "function collateralSourceChainOf(bytes32) view returns (uint256)",
  "function remoteCollateral(bytes32) view returns (bool)",
  "function solanaCollateral(bytes32) view returns (bool)",
  "function remoteActionNonce(bytes32) view returns (uint256)",
  "function remoteReturnDeducted(bytes32) view returns (bool)",
  "function collateralOwnerOf(bytes32) view returns (address)",
  "function pendingCollateralTopUp(bytes32) view returns (uint256 amount,bytes32 actionHash,uint256 revision,uint256 deadline)",
  "function pendingRemoteReturn(bytes32) view returns (uint256)",
  "function remoteReturnActionHash(bytes32) view returns (bytes32)",
  "function remoteReturnDeadline(bytes32) view returns (uint256)",
  "function pendingRemoteSeizure(bytes32) view returns (uint256)",
  "function remoteSeizureActionHash(bytes32) view returns (bytes32)",
  "function remoteSeizureRecipient(bytes32) view returns (address)",
  "function remoteSeizureDeadline(bytes32) view returns (uint256)",
  "function remoteRecoveryVaultOf(bytes32) view returns (address)",
  "function recoveryKeepers(address) view returns (bool)",
]);
const domain = keccak256(stringToHex("Termbook remote collateral action v1"));
const zero = `0x${"0".repeat(64)}`;
const zeroAddress = "0x0000000000000000000000000000000000000000";

export type RemoteAction = {
  monadChain: bigint;
  monadCore: Address;
  sourceChain: bigint;
  sourceVault: Address;
  creditId: Hex;
  lockId: Hex;
  asset: Address;
  kind: 0 | 1 | 2;
  recipient: Address;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
};

export type RemoteActionRecord = {
  actionHash: string;
  creditId: string;
  kind: 0 | 1 | 2;
  authorizationTxHash: string;
  action: { [K in keyof RemoteAction]: string | number };
};

export function hashRemoteAction(action: RemoteAction): Hex {
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "uint256" },
    { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" },
    { type: "uint8" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
  ], [domain, action.monadChain, action.monadCore, action.sourceChain, action.sourceVault,
    action.creditId, action.lockId, action.asset, action.kind, action.recipient,
    action.amount, action.nonce, action.deadline]));
}

export function serializeAction(action: RemoteAction): RemoteActionRecord["action"] {
  return {
    monadChain: action.monadChain.toString(), monadCore: action.monadCore.toLowerCase(),
    sourceChain: action.sourceChain.toString(), sourceVault: action.sourceVault.toLowerCase(),
    creditId: action.creditId.toLowerCase(), lockId: action.lockId.toLowerCase(),
    asset: action.asset.toLowerCase(), kind: action.kind, recipient: action.recipient.toLowerCase(),
    amount: action.amount.toString(), nonce: action.nonce.toString(), deadline: action.deadline.toString(),
  };
}

export function parseStoredAction(value: RemoteActionRecord["action"]): RemoteAction {
  return {
    monadChain: BigInt(value.monadChain), monadCore: value.monadCore as Address,
    sourceChain: BigInt(value.sourceChain), sourceVault: value.sourceVault as Address,
    creditId: value.creditId as Hex, lockId: value.lockId as Hex,
    asset: value.asset as Address, kind: value.kind as 0 | 1 | 2,
    recipient: value.recipient as Address, amount: BigInt(value.amount),
    nonce: BigInt(value.nonce), deadline: BigInt(value.deadline),
  };
}

export async function readAuthorizedAction(creditId: Hex, kind: 0 | 1 | 2, requester?: Address, allowExpired = false) {
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new Error("remote-action-monad-chain-mismatch");
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  const core = env.core as Address;
  const at = finalized.number;
  const topUp = kind === 2 ? await chain.readContract({ address: core, abi: coreAbi, functionName: "pendingCollateralTopUp", args: [creditId], blockNumber: at }) : undefined;
  const deducted = kind === 0 ? await chain.readContract({ address: core, abi: coreAbi, functionName: "remoteReturnDeducted", args: [creditId], blockNumber: at }) : false;
  const [credit, sourceChain, remote, solana, nonce, amount, actionHash, recipient, deadline, recoveryVault] = await Promise.all([
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "collateralSourceChainOf", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "remoteCollateral", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "solanaCollateral", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "remoteActionNonce", args: [creditId], blockNumber: at }),
    topUp ? Promise.resolve(topUp[0]) : chain.readContract({ address: core, abi: coreAbi, functionName: kind === 0 ? "pendingRemoteReturn" : "pendingRemoteSeizure", args: [creditId], blockNumber: at }),
    topUp ? Promise.resolve(topUp[1]) : chain.readContract({ address: core, abi: coreAbi, functionName: kind === 0 ? "remoteReturnActionHash" : "remoteSeizureActionHash", args: [creditId], blockNumber: at }),
    kind === 2 ? chain.readContract({ address: core, abi: coreAbi, functionName: "collateralOwnerOf", args: [creditId], blockNumber: at }) : kind === 0 ? Promise.resolve(creditId) : chain.readContract({ address: core, abi: coreAbi, functionName: "remoteSeizureRecipient", args: [creditId], blockNumber: at }),
    topUp ? Promise.resolve(topUp[3]) : chain.readContract({ address: core, abi: coreAbi, functionName: kind === 0 ? "remoteReturnDeadline" : "remoteSeizureDeadline", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "remoteRecoveryVaultOf", args: [creditId], blockNumber: at }),
  ]);
  if (!remote || solana || !isEvmSource(sourceChain) || nonce === 0n || amount === 0n
    || actionHash.toLowerCase() === zero || credit.lockId.toLowerCase() === zero
    || credit.collateralVault.toLowerCase() === zeroAddress || credit.collateralAsset.toLowerCase() === zeroAddress
    || recoveryVault.toLowerCase() === zeroAddress || (kind !== 2 && deducted !== true && amount > credit.collateralAmount)) {
    throw new Error("remote-action-unavailable");
  }
  if (requester) {
    const allowed = kind !== 1
      ? requester.toLowerCase() === credit.borrower.toLowerCase()
      : await chain.readContract({ address: core, abi: coreAbi, functionName: "recoveryKeepers", args: [requester], blockNumber: at });
    if (!allowed) throw new Error("permission-denied");
  }
  const action: RemoteAction = {
    monadChain: BigInt(env.monadChainId), monadCore: core, sourceChain,
    sourceVault: credit.collateralVault, creditId, lockId: credit.lockId, asset: credit.collateralAsset,
    kind, recipient: kind === 0 ? credit.returnRecipient : recipient as Address,
    amount, nonce, deadline,
  };
  if (deadline === 0n || action.recipient.toLowerCase() === zeroAddress
    || (kind === 1 && action.recipient.toLowerCase() !== recoveryVault.toLowerCase())
    || (!allowExpired && deadline <= BigInt(Math.floor(Date.now() / 1000) + 120))
    || hashRemoteAction(action).toLowerCase() !== actionHash.toLowerCase()) {
    throw new Error("remote-action-mismatch");
  }
  return { action, actionHash: actionHash as Hex, collateralAmount: credit.collateralAmount };
}
