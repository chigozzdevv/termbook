import { assertKeeperFunding, assertSignedKeeperFunding } from "../chain/keeper-funding.js";
import { ethereumSourceChain } from "../chain/networks.js";
import { createWalletClient, encodeAbiParameters, encodeFunctionData, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { termbookCoreAbi, verifierRegistryAbi } from "@termbook/bindings";
import { drainQueue, registerHandler } from "../queue/queue.worker.js";
import { fetchProof } from "../chain/source.client.js";
import { ethereumWormholeMode, fetchEthereumSnapshot } from "../chain/ethereum-wormhole-snapshot.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { collateralRepo } from "./collateral.repo.js";

const ethereumVerifierAbi = parseAbi([
  "function sourceVault() view returns (address)",
  "function sourceVaultCodeHash() view returns (bytes32)",
  "function verifyLock(bytes header, bytes proof, address vault, bytes32 lockDigest) view returns (bool)",
]);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const bytes32 = /^0x[0-9a-fA-F]{64}$/;

type LockContext = {
  creditId: Hex;
  lockId: Hex;
  borrower: Address;
  owner: Address;
  vault: Address;
  asset: Address;
  amount: bigint;
  sourceChain: bigint;
  returnRecipient: Address;
  recoveryVault: Address;
  monadChain: bigint;
  core: Address;
};

export function lockCommitment(input: LockContext): Hex {
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
    { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" },
    { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" },
  ], [
    input.creditId, input.lockId, input.borrower, input.owner, input.vault, input.asset,
    input.amount, input.sourceChain, input.returnRecipient, input.recoveryVault, input.monadChain, input.core,
  ]));
}

function configured(): boolean {
  return Boolean(env.sourceRpcUrl && env.collateralKeeperKey
    && (env.sourceBeaconApiUrl || (env.wormholeScanUrl && env.sourceWormholePublisherKey)));
}

export async function handleCollateralJob(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.kind !== "collateral.tracked") return;
  if (!configured()) throw new Error("collateral-worker-unavailable");
  const lockId = job.payload["lockId"];
  if (typeof lockId !== "string" || !bytes32.test(lockId)) throw new Error("param-invalid");
  const tracked = await collateralRepo.find(lockId);
  if (!tracked || typeof tracked.creditId !== "string" || !bytes32.test(tracked.creditId)
    || typeof tracked.owner !== "string" || typeof tracked.amount !== "string") {
    throw new Error("collateral-track-missing");
  }
  const creditId = tracked.creditId as Hex;
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new Error("collateral-monad-chain-mismatch");
  const account = privateKeyToAccount(env.collateralKeeperKey as Hex);
  if (tracked.txHash) {
    await reconcileSigned(lockId, creditId, tracked.txHash, tracked.rawTx, account.address);
    return;
  }
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  const at = finalized.number;
  const [credit, sourceChain, remote, owner, recoveryVault, proven] = await Promise.all([
    chain.readContract({ address: env.core as Address, abi: termbookCoreAbi, functionName: "creditDetails", args: [creditId], blockNumber: at }),
    chain.readContract({ address: env.core as Address, abi: termbookCoreAbi, functionName: "collateralSourceChainOf", args: [creditId], blockNumber: at }),
    chain.readContract({ address: env.core as Address, abi: termbookCoreAbi, functionName: "remoteCollateral", args: [creditId], blockNumber: at }),
    chain.readContract({ address: env.core as Address, abi: termbookCoreAbi, functionName: "collateralOwnerOf", args: [creditId], blockNumber: at }),
    chain.readContract({ address: env.core as Address, abi: termbookCoreAbi, functionName: "remoteRecoveryVaultOf", args: [creditId], blockNumber: at }),
    chain.readContract({ address: env.core as Address, abi: termbookCoreAbi, functionName: "collateralProven", args: [creditId], blockNumber: at }),
  ]);
  if (!remote || !credit.collateralBound || sourceChain !== BigInt(ethereumSourceChain())
    || credit.lockId.toLowerCase() !== lockId.toLowerCase()
    || owner.toLowerCase() !== tracked.owner.toLowerCase()
    || recoveryVault.toLowerCase() === zeroAddress || credit.collateralVault.toLowerCase() === zeroAddress) {
    throw new Error("collateral-core-mismatch");
  }
  if (proven) {
    await collateralRepo.setProvenWithoutTx(lockId);
    return;
  }
  if ((credit.facility !== 2 && credit.facility !== 7) || credit.collateralAmount.toString() !== tracked.amount) {
    throw new Error("collateral-core-mismatch");
  }
  const configuredVault = await chain.readContract({
    address: env.core as Address, abi: termbookCoreAbi, functionName: "sourceCollateralVault",
    args: [sourceChain, credit.collateralAsset], blockNumber: at,
  });
  if (configuredVault.toLowerCase() !== credit.collateralVault.toLowerCase()) throw new Error("collateral-vault-unadmitted");
  const registry = await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi, functionName: "verifierRegistry", blockNumber: at });
  if (registry.toLowerCase() === zeroAddress) throw new Error("collateral-verifier-unavailable");
  const [verifier, version, active, , codeHash] = await chain.readContract({
    address: registry, abi: verifierRegistryAbi, functionName: "verifiers", args: [sourceChain], blockNumber: at,
  });
  if (!active || verifier.toLowerCase() === zeroAddress
    || version !== credit.verifierVersion || codeHash.toLowerCase() !== credit.verifierCodeHash.toLowerCase()) {
    throw new Error("collateral-verifier-mismatch");
  }
  const verifierCode = await chain.getCode({ address: verifier, blockNumber: at });
  if (!verifierCode || keccak256(verifierCode).toLowerCase() !== codeHash.toLowerCase()) {
    throw new Error("collateral-verifier-mismatch");
  }
  const [sourceVault, sourceCodeHash] = await Promise.all([
    chain.readContract({ address: verifier, abi: ethereumVerifierAbi, functionName: "sourceVault", blockNumber: at }),
    chain.readContract({ address: verifier, abi: ethereumVerifierAbi, functionName: "sourceVaultCodeHash", blockNumber: at }),
  ]);
  if (sourceVault.toLowerCase() !== credit.collateralVault.toLowerCase()) throw new Error("collateral-verifier-vault-mismatch");
  const commitment = lockCommitment({
    creditId, lockId: lockId as Hex, borrower: credit.borrower, owner,
    vault: credit.collateralVault, asset: credit.collateralAsset, amount: credit.collateralAmount,
    sourceChain, returnRecipient: credit.returnRecipient, recoveryVault,
    monadChain: BigInt(env.monadChainId), core: env.core as Address,
  });
  const proof = (await ethereumWormholeMode(verifier))
    ? await fetchEthereumSnapshot({
      verifier, vault: credit.collateralVault, kind: 1, digest: commitment, lockId: lockId as Hex,
    })
    : await fetchProof({
      rpcUrl: env.sourceRpcUrl, lockId: lockId as Hex,
      vault: credit.collateralVault, commitment, expectedCodeHash: sourceCodeHash,
    });
  await collateralRepo.setState(lockId, "proof_fetched", proof);
  const accepted = await chain.readContract({
    address: verifier, abi: ethereumVerifierAbi, functionName: "verifyLock",
    args: [proof.header, proof.proof, credit.collateralVault, commitment],
  });
  if (!accepted) throw new Error("collateral-proof-rejected");
  const data = encodeFunctionData({
    abi: termbookCoreAbi, functionName: "proveCollateral", args: [creditId, sourceChain, proof.header, proof.proof],
  });
  await chain.call({ account: account.address, to: env.core as Address, data });
  if (!await collateralRepo.acquireSigner(env.monadChainId, account.address, lockId)) {
    throw new Error("collateral-proof-signer-busy");
  }
  let signed = false;
  try {
    const winner = await collateralRepo.find(lockId);
    if (winner?.txHash) {
      signed = true;
      return;
    }
    const wallet = createWalletClient({ account, transport: http(env.rpcUrl) });
    const nonce = await chain.getTransactionCount({ address: account.address, blockTag: "pending" });
    const request = await wallet.prepareTransactionRequest({ account, chain: null, to: env.core as Address, data, nonce });
    await assertKeeperFunding(chain, account.address, request);
    const rawTx = await wallet.signTransaction({ ...request, chain: null });
    const hash = keccak256(rawTx);
    const persisted = await collateralRepo.setPrepared(lockId, proof, hash, rawTx);
    if (persisted.matchedCount !== 1) {
      const prepared = await collateralRepo.find(lockId);
      if (prepared?.txHash) {
        signed = true;
        return;
      }
      throw new Error("collateral-track-missing");
    }
    signed = true;
    await reconcileSigned(lockId, creditId, hash, rawTx, account.address);
  } finally {
    if (!signed) await collateralRepo.releaseSigner(env.monadChainId, account.address, lockId);
  }
}

async function deliver(hash: Hex, rawTx: Hex) {
  if (keccak256(rawTx).toLowerCase() !== hash.toLowerCase()) throw new Error("collateral-signed-transaction-mismatch");
  const chain = monadClient();
  let receipt = await chain.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) {
    try {
      await assertSignedKeeperFunding(chain, rawTx);
      const broadcastHash = await chain.sendRawTransaction({ serializedTransaction: rawTx });
      if (broadcastHash.toLowerCase() !== hash.toLowerCase()) throw new Error("collateral-transaction-hash-mismatch");
    } catch (error) {
      if (!(error instanceof Error) || !/already known|known transaction/i.test(error.message)) throw error;
    }
    receipt = await chain.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
  }
  if (!receipt) return null;
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (receipt.blockNumber > finalized.number) return { receipt, finalized: false, finalizedNumber: finalized.number };
  const canonical = await chain.getBlock({ blockNumber: receipt.blockNumber });
  return { receipt, finalized: canonical.hash.toLowerCase() === receipt.blockHash.toLowerCase(), finalizedNumber: finalized.number };
}

async function reconcileSigned(lockId: string, creditId: Hex, txHash: unknown, rawTx: unknown, signer: Address): Promise<void> {
  if (typeof rawTx !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(rawTx)
    || typeof txHash !== "string" || !bytes32.test(txHash)) throw new Error("collateral-signed-transaction-missing");
  if (!await collateralRepo.acquireSigner(env.monadChainId, signer, lockId)) {
    throw new Error("collateral-proof-signer-busy");
  }
  const delivered = await deliver(txHash as Hex, rawTx as Hex);
  if (!delivered) return;
  if (!delivered.finalized) {
    await collateralRepo.setMined(lockId, txHash);
    return;
  }
  if (delivered.receipt.status !== "success") {
    await collateralRepo.clearReverted(lockId, txHash);
    await collateralRepo.releaseSigner(env.monadChainId, signer, lockId);
    throw new Error("collateral-proof-transaction-reverted");
  }
  const proven = await monadClient().readContract({
    address: env.core as Address, abi: termbookCoreAbi, functionName: "collateralProven",
    args: [creditId], blockNumber: delivered.finalizedNumber,
  });
  if (!proven) {
    await collateralRepo.setReview(lockId, txHash, "collateral-proof-not-applied");
    await collateralRepo.releaseSigner(env.monadChainId, signer, lockId);
    throw new Error("collateral-proof-not-applied");
  }
  await collateralRepo.setProvenFromTx(lockId, txHash);
  await collateralRepo.releaseSigner(env.monadChainId, signer, lockId);
}

if (configured()) registerHandler(["collateral.tracked"], handleCollateralJob);

let running = false;
export async function runCollateralWorker(): Promise<number> {
  if (!configured() || running) return 0;
  running = true;
  try {
    const pending = await collateralRepo.listPending();
    for (const item of pending) {
      try {
        await handleCollateralJob({ kind: "collateral.tracked", payload: { lockId: item.lockId } });
      } catch (error) {
        logger.warn("collateral-proof-retry", { lockId: item.lockId, reason: error instanceof Error ? error.message : "unknown" });
      }
    }
    return drainQueue(handleCollateralJob, ["collateral.tracked"]);
  } finally {
    running = false;
  }
}
