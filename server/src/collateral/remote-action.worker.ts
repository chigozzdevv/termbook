import {
  createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, http, keccak256, parseAbi,
  type Address, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { termbookCoreAbi, verifierRegistryAbi } from "@termbook/bindings";
import { fetchMonadAuthorizationProof } from "../chain/monad-receipt-proof.js";
import { fetchSourceAppliedProof } from "../chain/source-receipt-proof.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { drainQueue, registerHandler } from "../queue/queue.worker.js";
import { remoteActionRepo } from "./remote-action.repo.js";
import { hashRemoteAction, parseStoredAction, readAuthorizedAction, serializeAction, type RemoteAction } from "./remote-action.js";

const vaultAbi = parseAbi([
  "function core() view returns (address)",
  "function asset() view returns (address)",
  "function chainId_() view returns (uint256)",
  "function remoteMode() view returns (bool)",
]);
const controllerAbi = parseAbi([
  "function vault() view returns (address)",
  "function monadCore() view returns (address)",
  "function monadChain() view returns (uint256)",
  "function recoveryVault() view returns (address)",
  "function verifier() view returns (address)",
  "function consumed(bytes32) view returns (bool)",
  "function execute((uint256 monadChain,address monadCore,uint256 sourceChain,address sourceVault,bytes32 creditId,bytes32 lockId,address asset,uint8 kind,address recipient,uint256 amount,uint256 nonce,uint256 deadline),bytes header,bytes proof)",
]);
const verifierAbi = parseAbi([
  "function admission() view returns (uint256 chainId,uint256 version,bytes32 bootstrap)",
  "function verifyEvent(bytes header,bytes proof,address emitter,bytes32 eventDigest) view returns (bool)",
]);
const recoveryVaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function controller() view returns (address)",
  "function monadChain() view returns (uint256)",
]);
const coreConfirmAbi = parseAbi([
  "function pendingRemoteReturn(bytes32) view returns (uint256)",
  "function remoteReturnActionHash(bytes32) view returns (bytes32)",
  "function pendingRemoteSeizure(bytes32) view returns (uint256)",
  "function remoteSeizureActionHash(bytes32) view returns (bytes32)",
  "function confirmRemoteReturn(bytes32 creditId,bytes header,bytes proof)",
  "function confirmRemoteSeizure(bytes32 creditId,bytes header,bytes proof)",
]);
const word = /^0x[0-9a-fA-F]{64}$/;
const zero = "0x0000000000000000000000000000000000000000";
const zeroHash = `0x${"0".repeat(64)}`;

function configured(): boolean {
  return Boolean(env.sourceRpcUrl && env.sourceProofUrl && env.monadProofUrl
    && env.sourceActionKeeperKey && env.monadConfirmKeeperKey);
}

function equal(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function readSourceBinding(source: PublicClient, action: RemoteAction, actionHash: Hex) {
  if (await source.getChainId() !== 1 || action.sourceChain !== 1n) throw new Error("remote-action-source-chain-mismatch");
  const finalized = await source.getBlock({ blockTag: "finalized" });
  const at = finalized.number;
  const [controller, asset, chainId, remoteMode] = await Promise.all([
    source.readContract({ address: action.sourceVault, abi: vaultAbi, functionName: "core", blockNumber: at }),
    source.readContract({ address: action.sourceVault, abi: vaultAbi, functionName: "asset", blockNumber: at }),
    source.readContract({ address: action.sourceVault, abi: vaultAbi, functionName: "chainId_", blockNumber: at }),
    source.readContract({ address: action.sourceVault, abi: vaultAbi, functionName: "remoteMode", blockNumber: at }),
  ]);
  if (controller === zero || !equal(asset, action.asset) || chainId !== 1n || !remoteMode) {
    throw new Error("remote-action-source-vault-mismatch");
  }
  const [vault, monadCore, monadChain, recoveryVault, verifier, consumed] = await Promise.all([
    source.readContract({ address: controller, abi: controllerAbi, functionName: "vault", blockNumber: at }),
    source.readContract({ address: controller, abi: controllerAbi, functionName: "monadCore", blockNumber: at }),
    source.readContract({ address: controller, abi: controllerAbi, functionName: "monadChain", blockNumber: at }),
    source.readContract({ address: controller, abi: controllerAbi, functionName: "recoveryVault", blockNumber: at }),
    source.readContract({ address: controller, abi: controllerAbi, functionName: "verifier", blockNumber: at }),
    source.readContract({ address: controller, abi: controllerAbi, functionName: "consumed", args: [actionHash], blockNumber: at }),
  ]);
  if (!equal(vault, action.sourceVault) || !equal(monadCore, action.monadCore)
    || monadChain !== action.monadChain || verifier === zero
    || (action.kind === 1 && !equal(recoveryVault, action.recipient))) {
    throw new Error("remote-action-controller-mismatch");
  }
  if (action.kind === 1) {
    const [recoveryAsset, recoveryController, recoveryMonadChain] = await Promise.all([
      source.readContract({ address: recoveryVault, abi: recoveryVaultAbi, functionName: "asset", blockNumber: at }),
      source.readContract({ address: recoveryVault, abi: recoveryVaultAbi, functionName: "controller", blockNumber: at }),
      source.readContract({ address: recoveryVault, abi: recoveryVaultAbi, functionName: "monadChain", blockNumber: at }),
    ]);
    if (!equal(recoveryAsset, action.asset) || !equal(recoveryController, controller)
      || recoveryMonadChain !== action.monadChain) throw new Error("remote-action-recovery-vault-mismatch");
  }
  return { controller, verifier, consumed, finalized };
}

async function deliver(source: PublicClient, actionHash: string, hash: Hex, rawTx: Hex) {
  if (!equal(keccak256(rawTx), hash)) throw new Error("remote-action-signed-transaction-mismatch");
  let receipt = await source.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) {
    try {
      const sent = await source.sendRawTransaction({ serializedTransaction: rawTx });
      if (!equal(sent, hash)) throw new Error("remote-action-transaction-hash-mismatch");
      await remoteActionRepo.state(actionHash, "submitted", hash);
    } catch (error) {
      if (!(error instanceof Error) || !/already known|known transaction/i.test(error.message)) throw error;
    }
    receipt = await source.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
  }
  if (!receipt) {
    await remoteActionRepo.state(actionHash, "submitted", hash);
    return "pending" as const;
  }
  const finalized = await source.getBlock({ blockTag: "finalized" });
  if (receipt.blockNumber > finalized.number) {
    await remoteActionRepo.state(actionHash, "mined", hash, { sourceBlockHash: receipt.blockHash });
    return "pending" as const;
  }
  const canonical = await source.getBlock({ blockNumber: receipt.blockNumber });
  if (!equal(canonical.hash, receipt.blockHash)) {
    await remoteActionRepo.state(actionHash, "submitted", hash);
    return "pending" as const;
  }
  if (receipt.status === "reverted") {
    await remoteActionRepo.state(actionHash, "reverted", hash, { failure: "remote-action-transaction-reverted" });
    return "reverted" as const;
  }
  await remoteActionRepo.state(actionHash, "mined", hash, { sourceBlockHash: receipt.blockHash });
  return "confirmed" as const;
}

async function readConfirmationState(action: RemoteAction, actionHash: Hex) {
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new Error("remote-action-monad-chain-mismatch");
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  const core = env.core as Address;
  const at = finalized.number;
  const [amount, authorizedHash] = await Promise.all([
    chain.readContract({ address: core, abi: coreConfirmAbi,
      functionName: action.kind === 0 ? "pendingRemoteReturn" : "pendingRemoteSeizure",
      args: [action.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreConfirmAbi,
      functionName: action.kind === 0 ? "remoteReturnActionHash" : "remoteSeizureActionHash",
      args: [action.creditId], blockNumber: at }),
  ]);
  if (amount === 0n && equal(authorizedHash, zeroHash)) return { done: true as const, finalized };
  if (amount !== action.amount || !equal(authorizedHash, actionHash)) {
    throw new Error("remote-action-core-confirmation-mismatch");
  }
  return { done: false as const, finalized };
}

async function deliverConfirmation(actionHash: string, hash: Hex, rawTx: Hex) {
  if (!equal(keccak256(rawTx), hash)) throw new Error("remote-action-confirm-signed-transaction-mismatch");
  const chain = monadClient();
  let receipt = await chain.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) {
    try {
      const sent = await chain.sendRawTransaction({ serializedTransaction: rawTx });
      if (!equal(sent, hash)) throw new Error("remote-action-confirm-transaction-hash-mismatch");
      await remoteActionRepo.confirmationState(actionHash, "confirm_submitted", hash);
    } catch (error) {
      if (!(error instanceof Error) || !/already known|known transaction/i.test(error.message)) throw error;
    }
    receipt = await chain.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
  }
  if (!receipt) {
    await remoteActionRepo.confirmationState(actionHash, "confirm_submitted", hash);
    return "pending" as const;
  }
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (receipt.blockNumber > finalized.number) {
    await remoteActionRepo.confirmationState(actionHash, "confirm_mined", hash, { confirmBlockHash: receipt.blockHash });
    return "pending" as const;
  }
  const canonical = await chain.getBlock({ blockNumber: receipt.blockNumber });
  if (!equal(canonical.hash, receipt.blockHash)) {
    await remoteActionRepo.confirmationState(actionHash, "confirm_submitted", hash);
    return "pending" as const;
  }
  if (receipt.status === "reverted") {
    await remoteActionRepo.confirmationState(actionHash, "confirm_reverted", hash, {
      failure: "remote-action-confirm-transaction-reverted",
    });
    return "reverted" as const;
  }
  await remoteActionRepo.confirmationState(actionHash, "confirm_mined", hash, { confirmBlockHash: receipt.blockHash });
  return "confirmed" as const;
}

async function confirmSourceAction(action: RemoteAction, actionHash: Hex, sourceTxHash: Hex): Promise<void> {
  const account = privateKeyToAccount(env.monadConfirmKeeperKey as Hex);
  const chain = monadClient();
  const record = await remoteActionRepo.find(actionHash);
  if (!record) throw new Error("remote-action-missing");
  if (record.confirmTxHash) {
    if (typeof record.confirmRawTx !== "string" || !word.test(record.confirmTxHash)) {
      throw new Error("remote-action-confirm-signed-transaction-missing");
    }
    if (!await remoteActionRepo.acquireSigner(account.address, actionHash, env.monadChainId)) {
      throw new Error("remote-action-confirm-signer-busy");
    }
    const delivered = await deliverConfirmation(actionHash, record.confirmTxHash as Hex, record.confirmRawTx as Hex);
    if (delivered === "pending") return;
    if (delivered === "reverted") {
      const finished = await readConfirmationState(action, actionHash);
      if (finished.done) await remoteActionRepo.confirmationState(actionHash, "finalized", record.confirmTxHash);
      await remoteActionRepo.releaseSigner(account.address, actionHash, env.monadChainId);
      return;
    }
  } else {
    const current = await readConfirmationState(action, actionHash);
    if (current.done) {
      await remoteActionRepo.finalizeWithoutConfirmation(actionHash);
      return;
    }
    const proof = await fetchSourceAppliedProof({
      txHash: sourceTxHash, vault: action.sourceVault, actionHash,
      lockId: action.lockId, recipient: action.recipient, amount: action.amount,
      kind: action.kind, finalityUrl: env.sourceProofUrl,
    });
    const credit = await chain.readContract({
      address: env.core as Address, abi: termbookCoreAbi, functionName: "creditDetails",
      args: [action.creditId], blockNumber: current.finalized.number,
    });
    if (!equal(credit.collateralVault, action.sourceVault) || !equal(credit.lockId, action.lockId)
      || !equal(credit.collateralAsset, action.asset)) throw new Error("remote-action-confirm-credit-mismatch");
    const registry = await chain.readContract({
      address: env.core as Address, abi: termbookCoreAbi, functionName: "verifierRegistry",
      blockNumber: current.finalized.number,
    });
    if (registry === zero) throw new Error("remote-action-confirm-verifier-unavailable");
    const [verifier, version, active, , codeHash] = await chain.readContract({
      address: registry, abi: verifierRegistryAbi, functionName: "verifiers",
      args: [1n], blockNumber: current.finalized.number,
    });
    if (!active || verifier === zero || version !== credit.verifierVersion
      || !equal(codeHash, credit.verifierCodeHash)) throw new Error("remote-action-confirm-verifier-mismatch");
    const code = await chain.getCode({ address: verifier, blockNumber: current.finalized.number });
    if (!code || !equal(keccak256(code), codeHash)) throw new Error("remote-action-confirm-verifier-mismatch");
    const digest = keccak256(encodeAbiParameters([
      { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint8" },
    ], [actionHash, action.lockId, action.recipient, action.amount, action.kind]));
    const accepted = await chain.readContract({
      address: verifier, abi: verifierAbi, functionName: "verifyEvent",
      args: [proof.header, proof.proof, action.sourceVault, digest],
    });
    if (!accepted) throw new Error("remote-action-confirm-proof-rejected");
    const functionName = action.kind === 0 ? "confirmRemoteReturn" : "confirmRemoteSeizure";
    await chain.simulateContract({
      address: env.core as Address, abi: coreConfirmAbi, functionName,
      args: [action.creditId, proof.header, proof.proof], account: account.address,
    });
    if (!await remoteActionRepo.acquireSigner(account.address, actionHash, env.monadChainId)) {
      throw new Error("remote-action-confirm-signer-busy");
    }
    const winner = await remoteActionRepo.find(actionHash);
    if (winner?.confirmTxHash) return;
    let persisted = false;
    try {
      const nonce = await chain.getTransactionCount({ address: account.address, blockTag: "pending" });
      const data = encodeFunctionData({ abi: coreConfirmAbi, functionName,
        args: [action.creditId, proof.header, proof.proof] });
      const wallet = createWalletClient({ account, transport: http(env.rpcUrl) });
      const request = await wallet.prepareTransactionRequest({
        account, chain: null, to: env.core as Address, data, nonce,
      });
      const rawTx = await wallet.signTransaction({ ...request, chain: null });
      const hash = keccak256(rawTx);
      const stored = await remoteActionRepo.prepareConfirmation(actionHash, hash, rawTx, nonce);
      if (stored.matchedCount !== 1) {
        const prepared = await remoteActionRepo.find(actionHash);
        if (prepared?.confirmTxHash) {
          persisted = true;
          return;
        }
        throw new Error("remote-action-confirm-record-missing");
      }
      persisted = true;
      const delivered = await deliverConfirmation(actionHash, hash, rawTx);
      if (delivered === "pending") return;
      if (delivered === "reverted") {
        const finished = await readConfirmationState(action, actionHash);
        if (finished.done) await remoteActionRepo.confirmationState(actionHash, "finalized", hash);
        await remoteActionRepo.releaseSigner(account.address, actionHash, env.monadChainId);
        return;
      }
    } finally {
      if (!persisted) await remoteActionRepo.releaseSigner(account.address, actionHash, env.monadChainId);
    }
  }
  const finished = await readConfirmationState(action, actionHash);
  if (!finished.done) throw new Error("remote-action-confirm-not-applied");
  const latest = await remoteActionRepo.find(actionHash);
  if (!latest?.confirmTxHash) throw new Error("remote-action-confirm-signed-transaction-missing");
  await remoteActionRepo.confirmationState(actionHash, "finalized", latest.confirmTxHash);
  await remoteActionRepo.releaseSigner(account.address, actionHash, env.monadChainId);
}

export async function handleRemoteActionJob(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.kind !== "collateral.remote-action") return;
  if (!configured()) throw new Error("remote-action-worker-unavailable");
  const actionHash = job.payload["actionHash"];
  if (typeof actionHash !== "string" || !word.test(actionHash)) throw new Error("remote-action-invalid");
  const record = await remoteActionRepo.find(actionHash);
  if (!record) throw new Error("remote-action-missing");
  if (["finalized", "reverted", "expired"].includes(record.state)) return;
  const action = parseStoredAction(record.action as ReturnType<typeof serializeAction>);
  if (!equal(hashRemoteAction(action), actionHash) || !equal(record.creditId, action.creditId)
    || record.kind !== action.kind || !word.test(record.authorizationTxHash)) {
    throw new Error("remote-action-record-mismatch");
  }
  if (record.state === "external_execution") {
    if ((await readConfirmationState(action, actionHash as Hex)).done) {
      await remoteActionRepo.finalizeExternallyConfirmed(actionHash);
    }
    return;
  }
  if (["source_finalized", "confirm_prepared", "confirm_submitted", "confirm_mined"].includes(record.state)) {
    if (!record.txHash || !word.test(record.txHash)) throw new Error("remote-action-source-tx-missing");
    await confirmSourceAction(action, actionHash as Hex, record.txHash as Hex);
    return;
  }
  const account = privateKeyToAccount(env.sourceActionKeeperKey as Hex);
  const source = createPublicClient({ transport: http(env.sourceRpcUrl) });
  let delivered: "pending" | "reverted" | "confirmed";
  if (record.txHash) {
    if (typeof record.rawTx !== "string" || !word.test(record.txHash)) throw new Error("remote-action-signed-transaction-missing");
    if (!await remoteActionRepo.acquireSigner(account.address, actionHash)) throw new Error("remote-action-signer-busy");
    delivered = await deliver(source, actionHash, record.txHash as Hex, record.rawTx as Hex);
  } else {
    const current = await readAuthorizedAction(action.creditId, action.kind);
    if (!equal(current.actionHash, actionHash)
      || JSON.stringify(serializeAction(current.action)) !== JSON.stringify(serializeAction(action))) {
      throw new Error("remote-action-stale");
    }
    const binding = await readSourceBinding(source, action, actionHash as Hex);
    if (binding.consumed) {
      await remoteActionRepo.state(actionHash, "external_execution", undefined, {
        failure: "remote-action-source-tx-required",
      });
      return;
    }
    if (action.deadline <= binding.finalized.timestamp + 120n) {
      await remoteActionRepo.state(actionHash, "expired");
      return;
    }
    const authorization = await fetchMonadAuthorizationProof({
      txHash: record.authorizationTxHash as Hex, core: action.monadCore, creditId: action.creditId,
      actionHash: actionHash as Hex, kind: action.kind, finalityUrl: env.monadProofUrl,
    });
    const [chainId, version, bootstrap] = await source.readContract({
      address: binding.verifier, abi: verifierAbi, functionName: "admission", blockNumber: binding.finalized.number,
    });
    if (chainId !== action.monadChain || version === 0n || BigInt(bootstrap) === 0n) {
      throw new Error("remote-action-verifier-unadmitted");
    }
    const digest = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }],
      [action.creditId, actionHash as Hex, action.kind],
    ));
    const accepted = await source.readContract({
      address: binding.verifier, abi: verifierAbi, functionName: "verifyEvent",
      args: [authorization.header, authorization.proof, action.monadCore, digest],
    });
    if (!accepted) throw new Error("remote-action-proof-rejected");
    await source.simulateContract({
      address: binding.controller, abi: controllerAbi, functionName: "execute",
      args: [action, authorization.header, authorization.proof], account: account.address,
    });
    if (!await remoteActionRepo.acquireSigner(account.address, actionHash)) throw new Error("remote-action-signer-busy");
    const currentRecord = await remoteActionRepo.find(actionHash);
    if (currentRecord?.txHash) return;
    const wallet = createWalletClient({ account, transport: http(env.sourceRpcUrl) });
    let persisted = false;
    try {
      const nonce = await source.getTransactionCount({ address: account.address, blockTag: "pending" });
      const request = await wallet.prepareTransactionRequest({
        account, chain: null, to: binding.controller, data: encodeFunctionData({
          abi: controllerAbi, functionName: "execute", args: [action, authorization.header, authorization.proof],
        }), nonce,
      });
      const rawTx = await wallet.signTransaction({ ...request, chain: null });
      const hash = keccak256(rawTx);
      const stored = await remoteActionRepo.prepare(actionHash, hash, rawTx, nonce);
      if (stored.matchedCount !== 1) {
        const winner = await remoteActionRepo.find(actionHash);
        if (winner?.txHash) {
          persisted = true;
          return;
        }
        throw new Error("remote-action-record-missing");
      }
      persisted = true;
      delivered = await deliver(source, actionHash, hash, rawTx);
    } finally {
      if (!persisted) await remoteActionRepo.releaseSigner(account.address, actionHash);
    }
  }
  if (delivered === "pending") return;
  if (delivered === "reverted") {
    await remoteActionRepo.releaseSigner(account.address, actionHash);
    return;
  }
  const updated = await remoteActionRepo.find(actionHash);
  if (!updated?.txHash) throw new Error("remote-action-signed-transaction-missing");
  const binding = await readSourceBinding(source, action, actionHash as Hex);
  if (!binding.consumed) throw new Error("remote-action-not-applied");
  await remoteActionRepo.state(actionHash, "source_finalized", updated.txHash);
  await remoteActionRepo.releaseSigner(account.address, actionHash);
  await confirmSourceAction(action, actionHash as Hex, updated.txHash as Hex);
}

if (configured()) registerHandler(["collateral.remote-action"], handleRemoteActionJob);

let running = false;
export async function runRemoteActionWorker(): Promise<number> {
  if (!configured() || running) return 0;
  running = true;
  try {
    const pending = await remoteActionRepo.listPending();
    for (const record of pending) {
      try {
        await handleRemoteActionJob({ kind: "collateral.remote-action", payload: { actionHash: record.actionHash } });
      } catch (error) {
        logger.warn("remote-action-retry", { actionHash: record.actionHash, reason: error instanceof Error ? error.message : "unknown" });
      }
    }
    return drainQueue(handleRemoteActionJob, ["collateral.remote-action"]);
  } finally {
    running = false;
  }
}
