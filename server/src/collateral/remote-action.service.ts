import { createPublicClient, decodeEventLog, encodeFunctionData, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { termbookCoreAbi, verifierRegistryAbi } from "@termbook/bindings";
import { monadClient } from "../chain/monad.client.js";
import { fetchConsumedActionProof, fetchUnconsumedActionProof } from "../chain/source.client.js";
import { ethereumWormholeMode, fetchEthereumSnapshot } from "../chain/ethereum-wormhole-snapshot.js";
import { appliedLogIndex } from "../chain/source-action-receipt.js";
import { env } from "../config/env.js";
import { queue } from "../queue/queue.client.js";
import { remoteActionRepo } from "./remote-action.repo.js";
import { solanaRelayConfig } from "./solana-relay.config.js";
import { solanaRelayRepo } from "./solana-relay.repo.js";
import { readSolanaAction } from "./solana-action.service.js";
import { hashRemoteAction, parseStoredAction, readAuthorizedAction, serializeAction } from "./remote-action.js";
import type { cancelRemoteActionSchema, remoteActionSchema, remoteActionSourceTxSchema } from "./remote-action.schema.js";
import type { z } from "zod";

type Input = z.infer<typeof remoteActionSchema>;
type SourceTxInput = z.infer<typeof remoteActionSourceTxSchema>;
type CancelInput = z.infer<typeof cancelRemoteActionSchema>;
const confirmAbi = parseAbi([
  "function confirmRemoteReturn(bytes32 creditId,bytes header,bytes proof)",
  "function confirmRemoteSeizure(bytes32 creditId,bytes header,bytes proof)",
]);
const cancelAbi = parseAbi([
  "function cancelExpiredRemoteReturn(bytes32 creditId,bytes header,bytes proof)",
  "function cancelExpiredRemoteSeizure(bytes32 creditId,bytes header,bytes proof)",
]);
const sourceVerifierAbi = parseAbi([
  "function sourceVault() view returns (address)",
  "function sourceController() view returns (address)",
  "function sourceControllerCodeHash() view returns (bytes32)",
  "function verifyUnconsumedAction(bytes header,bytes proof,address controller,bytes32 actionHash,uint256 deadline) view returns (bool)",
  "function verifyAppliedAction(bytes header,bytes proof,address vault,bytes32 actionHash) view returns (bool)",
]);
const zero = "0x0000000000000000000000000000000000000000";

export const remoteActionService = {
  async schedule(input: Input, requester: Address) {
    const chain = monadClient();
    const finalized = await chain.getBlock({ blockTag: "finalized" });
    if (await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
      functionName: "solanaCollateral", args: [input.creditId as Hex], blockNumber: finalized.number })) {
      if (!await solanaRelayConfig()) throw new Error("remote-action-worker-unavailable");
      const { actionHash, action } = await readSolanaAction({ creditId: input.creditId as Hex, kind: input.kind }, requester);
      if (action.kind === 2) throw new Error("remote-action-owner-funding-required");
      await verifyAuthorizationReceipt(input.creditId as Hex, actionHash, action.kind, input.authorizationTxHash as Hex);
      await solanaRelayRepo.open({ _id: actionHash.toLowerCase(), creditId: input.creditId as Hex,
        kind: action.kind, authorizationTxHash: input.authorizationTxHash as Hex });
      return { actionHash, creditId: input.creditId, kind: action.kind, state: "pending" };
    }
    if (!env.sourceRpcUrl || !(env.sourceBeaconApiUrl || (env.wormholeScanUrl && env.sourceWormholePublisherKey))
      || !env.sourceActionKeeperKey || !env.monadConfirmKeeperKey) {
      throw new Error("remote-action-worker-unavailable");
    }
    const kind = input.kind === "release" ? 0 : 1;
    const { action, actionHash } = await readAuthorizedAction(input.creditId as Hex, kind, requester);
    await verifyAuthorizationReceipt(input.creditId as Hex, actionHash, kind, input.authorizationTxHash as Hex);
    if (hashRemoteAction(action).toLowerCase() !== actionHash.toLowerCase()) throw new Error("remote-action-mismatch");
    const saved = await remoteActionRepo.open({
      actionHash: actionHash.toLowerCase(), creditId: input.creditId, kind,
      authorizationTxHash: input.authorizationTxHash,
      action: serializeAction(action),
    });
    if (saved.state !== "finalized" && saved.state !== "reverted" && saved.state !== "expired") {
      await queue.push({ kind: "collateral.remote-action", payload: { actionHash: actionHash.toLowerCase() } });
    }
    return {
      actionHash: saved.actionHash, creditId: saved.creditId, kind: saved.kind,
      authorizationTxHash: saved.authorizationTxHash,
      state: saved.state, txHash: saved.txHash, confirmTxHash: saved.confirmTxHash,
    };
  },
  async list(creditId: string) {
    return remoteActionRepo.listByCredit(creditId.toLowerCase());
  },
  async attachSourceTx(input: SourceTxInput, requester: Address) {
    if (!env.sourceRpcUrl || !(env.sourceBeaconApiUrl || (env.wormholeScanUrl && env.sourceWormholePublisherKey))
      || !env.monadConfirmKeeperKey) {
      throw new Error("remote-action-worker-unavailable");
    }
    const saved = await remoteActionRepo.find(input.actionHash);
    if (!saved) throw new Error("remote-action-missing");
    if (saved.txHash && saved.txHash.toLowerCase() === input.sourceTxHash && saved.state !== "external_execution") {
      return { actionHash: saved.actionHash, sourceTxHash: saved.txHash, state: saved.state };
    }
    if (saved.state !== "external_execution" || saved.txHash) throw new Error("remote-action-source-tx-conflict");
    const action = parseStoredAction(saved.action as ReturnType<typeof serializeAction>);
    if (hashRemoteAction(action).toLowerCase() !== input.actionHash) throw new Error("remote-action-record-mismatch");
    const current = await readAuthorizedAction(action.creditId, action.kind, requester);
    if (current.actionHash.toLowerCase() !== input.actionHash) throw new Error("remote-action-stale");
    const source = createPublicClient({ transport: http(env.sourceRpcUrl) });
    if (await source.getChainId() !== 1) throw new Error("source-action-chain-mismatch");
    const receipt = await source.getTransactionReceipt({ hash: input.sourceTxHash as Hex });
    const sourceFinalized = await source.getBlock({ blockTag: "finalized" });
    if (receipt.blockNumber > sourceFinalized.number) throw new Error("source-action-not-finalized");
    const sourceBlock = await source.getBlock({ blockNumber: receipt.blockNumber });
    if (sourceBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new Error("source-action-block-mismatch");
    }
    appliedLogIndex(receipt, {
      vault: action.sourceVault, actionHash: input.actionHash as Hex,
      lockId: action.lockId, recipient: action.recipient, amount: action.amount, kind: action.kind,
    });
    const chain = monadClient();
    const finalized = await chain.getBlock({ blockTag: "finalized" });
    const credit = await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
      functionName: "creditDetails", args: [action.creditId], blockNumber: finalized.number });
    const registry = await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
      functionName: "verifierRegistry", blockNumber: finalized.number });
    if (registry === zero) throw new Error("source-verifier-unavailable");
    const [verifier, version, active, , codeHash] = await chain.readContract({
      address: registry, abi: verifierRegistryAbi, functionName: "verifiers", args: [1n], blockNumber: finalized.number,
    });
    if (!active || verifier === zero || version !== credit.verifierVersion
      || codeHash.toLowerCase() !== credit.verifierCodeHash.toLowerCase()) throw new Error("source-verifier-mismatch");
    const runtime = await chain.getCode({ address: verifier, blockNumber: finalized.number });
    if (!runtime || keccak256(runtime).toLowerCase() !== codeHash.toLowerCase()) throw new Error("source-verifier-mismatch");
    const [vault, controller, controllerCodeHash] = await Promise.all([
      chain.readContract({ address: verifier, abi: sourceVerifierAbi, functionName: "sourceVault", blockNumber: finalized.number }),
      chain.readContract({ address: verifier, abi: sourceVerifierAbi, functionName: "sourceController", blockNumber: finalized.number }),
      chain.readContract({ address: verifier, abi: sourceVerifierAbi, functionName: "sourceControllerCodeHash", blockNumber: finalized.number }),
    ]);
    if (vault.toLowerCase() !== action.sourceVault.toLowerCase() || controller === zero
      || BigInt(controllerCodeHash) === 0n) throw new Error("source-controller-mismatch");
    const proof = (await ethereumWormholeMode(verifier))
      ? await fetchEthereumSnapshot({
        verifier, vault: action.sourceVault, controller, kind: 2, digest: input.actionHash as Hex,
      })
      : await fetchConsumedActionProof({
        rpcUrl: env.sourceRpcUrl, actionHash: input.actionHash as Hex,
        controller, expectedCodeHash: controllerCodeHash,
      });
    const accepted = await chain.readContract({ address: verifier, abi: sourceVerifierAbi,
      functionName: "verifyAppliedAction",
      args: [proof.header, proof.proof, action.sourceVault, input.actionHash as Hex] });
    if (!accepted) throw new Error("source-applied-proof-rejected");
    await chain.simulateContract({
      address: env.core as Address, abi: confirmAbi,
      functionName: action.kind === 0 ? "confirmRemoteReturn" : "confirmRemoteSeizure",
      args: [action.creditId, proof.header, proof.proof], account: requester,
    });
    const attached = await remoteActionRepo.attachExternalSourceTx(input.actionHash, input.sourceTxHash);
    if (attached.matchedCount !== 1) {
      const winner = await remoteActionRepo.find(input.actionHash);
      if (!winner?.txHash || winner.txHash.toLowerCase() !== input.sourceTxHash) {
        throw new Error("remote-action-source-tx-conflict");
      }
    }
    await queue.push({ kind: "collateral.remote-action", payload: { actionHash: input.actionHash } });
    return { actionHash: input.actionHash, sourceTxHash: input.sourceTxHash, state: "source_finalized" };
  },
  async prepareExpiredActionCancel(input: CancelInput, requester: Address) {
    if (!env.sourceRpcUrl || !(env.sourceBeaconApiUrl || (env.wormholeScanUrl && env.sourceWormholePublisherKey))) {
      throw new Error("source-proof-unavailable");
    }
    const kind = input.kind === "release" ? 0 : 1;
    const functionName = kind === 0 ? "cancelExpiredRemoteReturn" : "cancelExpiredRemoteSeizure";
    const { action, actionHash } = await readAuthorizedAction(input.creditId as Hex, kind, undefined, true);
    const chain = monadClient();
    const finalized = await chain.getBlock({ blockTag: "finalized" });
    const credit = await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
      functionName: "creditDetails", args: [action.creditId], blockNumber: finalized.number });
    const registry = await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
      functionName: "verifierRegistry", blockNumber: finalized.number });
    if (registry === zero) throw new Error("source-verifier-unavailable");
    const [verifier, version, active, , codeHash] = await chain.readContract({
      address: registry, abi: verifierRegistryAbi, functionName: "verifiers", args: [1n], blockNumber: finalized.number,
    });
    if (!active || verifier === zero || version !== credit.verifierVersion
      || codeHash.toLowerCase() !== credit.verifierCodeHash.toLowerCase()) {
      throw new Error("source-verifier-mismatch");
    }
    const runtime = await chain.getCode({ address: verifier, blockNumber: finalized.number });
    if (!runtime || keccak256(runtime).toLowerCase() !== codeHash.toLowerCase()) {
      throw new Error("source-verifier-mismatch");
    }
    const [vault, controller, controllerCodeHash] = await Promise.all([
      chain.readContract({ address: verifier, abi: sourceVerifierAbi, functionName: "sourceVault", blockNumber: finalized.number }),
      chain.readContract({ address: verifier, abi: sourceVerifierAbi, functionName: "sourceController", blockNumber: finalized.number }),
      chain.readContract({ address: verifier, abi: sourceVerifierAbi, functionName: "sourceControllerCodeHash", blockNumber: finalized.number }),
    ]);
    if (vault.toLowerCase() !== action.sourceVault.toLowerCase() || controller === zero
      || BigInt(controllerCodeHash) === 0n) throw new Error("source-controller-mismatch");
    const proof = (await ethereumWormholeMode(verifier))
      ? await fetchEthereumSnapshot({
        verifier, vault: action.sourceVault, controller, kind: 3,
        digest: actionHash, deadline: action.deadline,
      })
      : await fetchUnconsumedActionProof({
        rpcUrl: env.sourceRpcUrl, actionHash,
        controller, expectedCodeHash: controllerCodeHash, deadline: action.deadline,
      });
    const accepted = await chain.readContract({
      address: verifier, abi: sourceVerifierAbi, functionName: "verifyUnconsumedAction",
      args: [proof.header, proof.proof, controller, actionHash, action.deadline],
    });
    if (!accepted) throw new Error("source-absence-proof-rejected");
    await chain.simulateContract({
      address: env.core as Address, abi: cancelAbi, functionName,
      args: [action.creditId, proof.header, proof.proof], account: requester,
    });
    return {
      actionHash, sourceBlockHash: proof.blockHash,
      transaction: {
        to: env.core,
        data: encodeFunctionData({ abi: cancelAbi, functionName,
          args: [action.creditId, proof.header, proof.proof] }),
      },
    };
  },
};

export async function verifyAuthorizationReceipt(creditId: Hex, actionHash: Hex, kind: 0 | 1 | 2, hash: Hex): Promise<void> {
  const chain = monadClient();
  const receipt = await chain.getTransactionReceipt({ hash });
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (receipt.status !== "success" || receipt.blockNumber > finalized.number) throw new Error("remote-action-authorization-unfinalized");
  const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash || block.transactions[receipt.transactionIndex] !== hash) {
    throw new Error("remote-action-authorization-noncanonical");
  }
  const matches = receipt.logs.filter((log) => {
    if (log.address.toLowerCase() !== env.core.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi: termbookCoreAbi, topics: log.topics, data: log.data, strict: true });
      return decoded.eventName === "RemoteActionAuthorized" && decoded.args.creditId.toLowerCase() === creditId.toLowerCase()
        && decoded.args.actionHash.toLowerCase() === actionHash.toLowerCase() && decoded.args.kind === kind;
    } catch { return false; }
  });
  if (matches.length !== 1) throw new Error("remote-action-authorization-mismatch");
}

export async function scheduleFinalizedAction(input: { creditId: Hex; actionHash: Hex; kind: 0 | 1 | 2; authorizationTxHash: Hex }) {
  const chain = monadClient();
  const at = (await chain.getBlock({ blockTag: "finalized" })).number;
  const current = input.kind === 2 ? (await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
    functionName: "pendingCollateralTopUp", args: [input.creditId], blockNumber: at }))[1] : await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
    functionName: input.kind === 0 ? "remoteReturnActionHash" : "remoteSeizureActionHash", args: [input.creditId], blockNumber: at });
  if (current.toLowerCase() !== input.actionHash.toLowerCase()) return;
  await verifyAuthorizationReceipt(input.creditId, input.actionHash, input.kind, input.authorizationTxHash);
  const { action, actionHash } = await readAuthorizedAction(input.creditId, input.kind);
  await remoteActionRepo.open({ actionHash: actionHash.toLowerCase(), creditId: input.creditId,
    kind: input.kind, authorizationTxHash: input.authorizationTxHash, action: serializeAction(action) });
  await queue.push({ kind: "collateral.remote-action", payload: { actionHash: actionHash.toLowerCase() } });
}
