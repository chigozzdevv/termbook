import { createWalletClient, encodeFunctionData, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { termbookCoreAbi, verifierRegistryAbi } from "@termbook/bindings";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { drainQueue, registerHandler } from "../queue/queue.worker.js";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { solanaAlias } from "../quote/solana.js";
import { solanaProofConfig } from "./solana.config.js";
import { fetchSolanaProof } from "./solana-proof.js";
import { solanaRepo } from "./solana.repo.js";

const verifierAbi = parseAbi([
  "function verifySolanaLock(bytes header,bytes proof,bytes32 sourceGenesis,bytes32 programId,bytes32 programDataHash,bytes32 lockDigest) view returns (bool)",
]);
const solanaAbi = parseAbi([
  "function solanaCollateral(bytes32) view returns (bool)",
  "function solanaIdentityOf(bytes32) view returns (bytes32 sourceGenesis,bytes32 programId,bytes32 sourceAsset,bytes32 sourceOwner,bytes32 returnRecipient,bytes32 recoveryVault,uint64 verifierVersion)",
  "function solanaLockPdaOf(bytes32) view returns (bytes32)",
  "function solanaMarkets(uint256) view returns (bytes32 sourceGenesis,bytes32 programId,bytes32 programDataHash,bytes32 sourceAsset,bool active)",
  "function solanaLockDigest(bytes32) view returns (bytes32)",
  "function proveSolanaCollateral(bytes32 creditId,bytes header,bytes proof)",
]);
const word = /^0x[0-9a-fA-F]{64}$/;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const zeroWord = `0x${"0".repeat(64)}`;

function field(value: unknown, key: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function same(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

async function deliver(hash: Hex, rawTx: Hex) {
  if (!same(keccak256(rawTx), hash)) throw new Error("solana-proof-signed-tx-mismatch");
  const chain = monadClient();
  let receipt = await chain.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) {
    try {
      const sent = await chain.sendRawTransaction({ serializedTransaction: rawTx });
      if (!same(sent, hash)) throw new Error("solana-proof-tx-hash-mismatch");
    } catch (error) {
      if (!(error instanceof Error) || !/already known|known transaction/i.test(error.message)) throw error;
    }
    receipt = await chain.waitForTransactionReceipt({ hash, timeout: 60_000 }).catch(() => null);
  }
  if (!receipt) return null;
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (receipt.blockNumber > finalized.number) return { receipt, finalized: false, at: finalized.number };
  const canonical = await chain.getBlock({ blockNumber: receipt.blockNumber });
  return { receipt, finalized: same(canonical.hash, receipt.blockHash), at: finalized.number };
}

async function reconcile(lockId: string, creditId: Hex, hash: Hex, rawTx: Hex, signer: Address): Promise<void> {
  if (!await solanaRepo.acquireSigner(env.monadChainId, signer, lockId)) throw new Error("solana-proof-signer-busy");
  const delivered = await deliver(hash, rawTx);
  if (!delivered) return;
  if (!delivered.finalized) {
    await solanaRepo.setMined(lockId, hash);
    return;
  }
  if (delivered.receipt.status !== "success") {
    await solanaRepo.clearReverted(lockId, hash);
    await solanaRepo.releaseSigner(env.monadChainId, signer, lockId);
    throw new Error("solana-proof-tx-reverted");
  }
  const proven = await monadClient().readContract({ address: env.core as Address, abi: termbookCoreAbi,
    functionName: "collateralProven", args: [creditId], blockNumber: delivered.at });
  if (!proven) {
    await solanaRepo.setReview(lockId, hash, "solana-proof-not-applied");
    await solanaRepo.releaseSigner(env.monadChainId, signer, lockId);
    throw new Error("solana-proof-not-applied");
  }
  await solanaRepo.setProven(lockId, hash);
  await solanaRepo.releaseSigner(env.monadChainId, signer, lockId);
}

async function processSolanaLockJob(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.kind !== "collateral.solana-lock") return;
  const config = solanaProofConfig();
  if (!config) throw new Error("solana-proof-worker-unavailable");
  const lockId = job.payload["lockId"];
  if (typeof lockId !== "string" || !word.test(lockId)) throw new Error("solana-lock-id-invalid");
  const tracked = await solanaRepo.find(lockId);
  if (!tracked || typeof tracked.creditId !== "string" || !word.test(tracked.creditId)
    || typeof tracked.lockPda !== "string" || !word.test(tracked.lockPda)) throw new Error("solana-lock-track-missing");
  const creditId = tracked.creditId as Hex;
  if (typeof tracked.txHash === "string") {
    if (!word.test(tracked.txHash) || typeof tracked.rawTx !== "string"
      || !/^0x(?:[0-9a-fA-F]{2})+$/.test(tracked.rawTx)) throw new Error("solana-proof-signed-tx-missing");
    await reconcile(lockId, creditId, tracked.txHash as Hex, tracked.rawTx as Hex, config.keeper.address);
    return;
  }
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new Error("solana-monad-chain-mismatch");
  const at = (await chain.getBlock({ blockTag: "finalized" })).number;
  const core = env.core as Address;
  const [credit, sourceChain, isSolana, identity, pda, proven] = await Promise.all([
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "collateralSourceChainOf", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: solanaAbi, functionName: "solanaCollateral", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: solanaAbi, functionName: "solanaIdentityOf", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: solanaAbi, functionName: "solanaLockPdaOf", args: [creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "collateralProven", args: [creditId], blockNumber: at }),
  ]);
  if (!isSolana || !credit.collateralBound || !same(credit.lockId, lockId)
    || !same(pda, tracked.lockPda) || sourceChain <= 0n) throw new Error("solana-core-binding-mismatch");
  if (proven) {
    await solanaRepo.setProven(lockId);
    return;
  }
  if ((credit.facility !== 2 && credit.facility !== 7)
    || !same(field(identity, "sourceAsset", 2), NATIVE_SOL_ASSET_BYTES)
    || BigInt(String(field(identity, "verifierVersion", 6))) !== credit.verifierVersion) {
    throw new Error("solana-core-binding-mismatch");
  }
  const genesis = field(identity, "sourceGenesis", 0) as Hex;
  const programId = field(identity, "programId", 1) as Hex;
  const owner = field(identity, "sourceOwner", 3) as Hex;
  const returnRecipient = field(identity, "returnRecipient", 4) as Hex;
  const recoveryVault = field(identity, "recoveryVault", 5) as Hex;
  if ([genesis, programId, owner, returnRecipient, recoveryVault].some((value) => !word.test(value) || value === zeroWord)
    || !same(credit.collateralVault, solanaAlias(genesis, programId))
    || !same(credit.collateralAsset, solanaAlias(genesis, NATIVE_SOL_ASSET_BYTES))
    || !same(credit.returnRecipient, solanaAlias(genesis, returnRecipient))) {
    throw new Error("solana-core-binding-mismatch");
  }
  const [market, registry, digest] = await Promise.all([
    chain.readContract({ address: core, abi: solanaAbi, functionName: "solanaMarkets", args: [sourceChain], blockNumber: at }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "verifierRegistry", blockNumber: at }),
    chain.readContract({ address: core, abi: solanaAbi, functionName: "solanaLockDigest", args: [creditId], blockNumber: at }),
  ]);
  const programDataHash = field(market, "programDataHash", 2) as Hex;
  if (!same(field(market, "sourceGenesis", 0), genesis)
    || !same(field(market, "programId", 1), programId)
    || !word.test(programDataHash) || BigInt(programDataHash) === 0n
    || !same(field(market, "sourceAsset", 3), NATIVE_SOL_ASSET_BYTES)
    || registry === zeroAddress) throw new Error("solana-market-unavailable");
  const [verifier, version, active, , codeHash] = await chain.readContract({
    address: registry, abi: verifierRegistryAbi, functionName: "verifiers", args: [sourceChain], blockNumber: at,
  });
  if (!active || verifier === zeroAddress || version !== credit.verifierVersion
    || !same(codeHash, credit.verifierCodeHash)) throw new Error("solana-verifier-unavailable");
  const runtime = await chain.getCode({ address: verifier, blockNumber: at });
  if (!runtime || !same(keccak256(runtime), codeHash)) throw new Error("solana-verifier-code-mismatch");
  const proof = await fetchSolanaProof({ rpcUrl: config.rpcUrl, proofUrl: config.proofUrl, kind: "lock",
    id: lockId as Hex, digest, genesis, programId, programDataHash, lockPda: tracked.lockPda as Hex });
  const verified = await chain.readContract({ address: verifier, abi: verifierAbi, functionName: "verifySolanaLock",
    args: [proof.header, proof.proof, genesis, programId, programDataHash, digest], blockNumber: at });
  if (!verified) throw new Error("solana-proof-rejected");
  const data = encodeFunctionData({ abi: solanaAbi, functionName: "proveSolanaCollateral",
    args: [creditId, proof.header, proof.proof] });
  await chain.call({ account: config.keeper.address, to: core, data });
  if (!await solanaRepo.acquireSigner(env.monadChainId, config.keeper.address, lockId)) {
    throw new Error("solana-proof-signer-busy");
  }
  let persisted = false;
  try {
    const winner = await solanaRepo.find(lockId);
    if (winner?.txHash) return;
    const wallet = createWalletClient({ account: config.keeper, transport: http(env.rpcUrl) });
    const nonce = await chain.getTransactionCount({ address: config.keeper.address, blockTag: "pending" });
    const request = await wallet.prepareTransactionRequest({ account: config.keeper, chain: null, to: core, data, nonce });
    const rawTx = await wallet.signTransaction({ ...request, chain: null });
    const hash = keccak256(rawTx);
    const saved = await solanaRepo.setPrepared(lockId, proof, hash, rawTx);
    if (saved.matchedCount !== 1) {
      if ((await solanaRepo.find(lockId))?.txHash) return;
      throw new Error("solana-proof-track-missing");
    }
    persisted = true;
    await reconcile(lockId, creditId, hash, rawTx, config.keeper.address);
  } finally {
    if (!persisted) await solanaRepo.releaseSigner(env.monadChainId, config.keeper.address, lockId);
  }
}

export async function handleSolanaLockJob(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  if (job.kind !== "collateral.solana-lock") return;
  const lockId = job.payload["lockId"];
  if (typeof lockId !== "string" || !word.test(lockId)) throw new Error("solana-lock-id-invalid");
  const token = await solanaRepo.claim(lockId);
  if (!token) return;
  try {
    await processSolanaLockJob(job);
  } finally {
    await solanaRepo.releaseClaim(lockId, token);
  }
}

if (solanaProofConfig()) registerHandler(["collateral.solana-lock"], handleSolanaLockJob);

let running = false;
export async function runSolanaLockWorker(): Promise<number> {
  if (!solanaProofConfig() || running) return 0;
  running = true;
  try {
    const pending = await solanaRepo.pending();
    for (const item of pending) {
      try {
        await handleSolanaLockJob({ kind: "collateral.solana-lock", payload: { lockId: item.lockId } });
      } catch (error) {
        logger.warn("solana-proof-retry", { lockId: item.lockId,
          reason: error instanceof Error ? error.message : "unknown" });
      }
    }
    return drainQueue(handleSolanaLockJob, ["collateral.solana-lock"]);
  } finally {
    running = false;
  }
}
