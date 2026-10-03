import { assertKeeperFunding, assertSignedKeeperFunding } from "../chain/keeper-funding.js";
import {
  createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, http,
  keccak256, parseAbi, recoverTypedDataAddress, stringToHex, type Address, type Hex,
} from "viem";
import { logger } from "../logging/logger.js";
import { recoveryConfig } from "./recovery.config.js";
import { recoveryRepo } from "./recovery.repo.js";
import { refundRepo } from "./refund.repo.js";
import { refundDigest, refundTypedData, verifyFinalizedRefund, type RefundRecord } from "./refund.plan.js";

const sourceAbi = parseAbi([
  "function routeSigner() view returns (address)",
  "function riskSigner() view returns (address)",
  "function usedRefundTxHash(bytes32) view returns (bool)",
  "function recordSourceRefund(bytes32 operationId,bytes32 refundTxHash,uint256 amount,uint256 nonce,uint256 deadline,bytes routeSignature,bytes riskSignature)",
]);
const refundedTopic = keccak256(stringToHex("SourceRefundRecorded(bytes32,bytes32,uint256)"));
const word = /^0x[0-9a-fA-F]{64}$/;
let running = false;
const bump = (value: string | undefined): bigint => value ? BigInt(value) * 6n / 5n + 1n : 0n;
const max = (a: bigint, b: bigint): bigint => a > b ? a : b;

function recordedLog(
  receipt: { status: string; logs: readonly { address: string; topics: readonly string[]; data: string }[] },
  record: RefundRecord,
): boolean {
  if (receipt.status !== "success") return false;
  const amount = encodeAbiParameters([{ type: "uint256" }], [BigInt(record.amount)]);
  return receipt.logs.filter((log) =>
    log.address.toLowerCase() === record.recoveryVault.toLowerCase()
      && log.topics.length === 3 && log.topics[0]?.toLowerCase() === refundedTopic.toLowerCase()
      && log.topics[1]?.toLowerCase() === record.creditId.toLowerCase()
      && log.topics[2]?.toLowerCase() === record.operationId.toLowerCase()
      && log.data.toLowerCase() === amount.toLowerCase()).length === 1;
}

async function reconcileRefund(refundTxHash: string): Promise<boolean> {
  const claim = await refundRepo.claim(refundTxHash);
  if (!claim) return false;
  const record = claim.record as RefundRecord;
  const config = recoveryConfig();
  if (!config) throw new Error("recovery-refund-config-unavailable");
  const rpc = config.sourceRpcs[record.sourceChain];
  if (!rpc) throw new Error("recovery-refund-rpc-unavailable");
  const source = createPublicClient({ transport: http(rpc) });
  const signerLock = `refund:${record.refundTxHash}`;
  let acquired = false;
  let persisted = Boolean(record.txHash);
  try {
    if (!word.test(record.refundTxHash) || record.refundDigest.toLowerCase() !== refundDigest(record).toLowerCase()
      || !record.riskSignature || !/^0x[0-9a-fA-F]{130}$/.test(record.riskSignature)
      || record.riskSigner.toLowerCase() !== config.riskSigner.toLowerCase()) {
      throw new Error("recovery-refund-record-invalid");
    }
    const riskSigner = await recoverTypedDataAddress({ ...refundTypedData(record), signature: record.riskSignature as Hex });
    if (riskSigner.toLowerCase() !== record.riskSigner.toLowerCase()) {
      throw new Error("recovery-refund-risk-signature-invalid");
    }
    if (await source.getChainId() !== record.sourceChain) throw new Error("recovery-refund-chain-mismatch");
    if (!await recoveryRepo.acquireFunder(record.sourceChain, config.funder.address, signerLock)) {
      return false;
    }
    acquired = true;
    if (!record.txHash) {
      if (record.deadline <= Math.floor(Date.now() / 1000) + 120) {
        throw new Error("recovery-refund-approval-expired");
      }
      const evidence = await verifyFinalizedRefund(record, rpc);
      if (evidence.amount !== BigInt(record.amount)) {
        throw new Error("recovery-refund-evidence-mismatch");
      }
      const finalized = await source.getBlock({ blockTag: "finalized" });
      const [routeSigner, currentRiskSigner] = await Promise.all([
        source.readContract({ address: record.recoveryVault as Address, abi: sourceAbi, functionName: "routeSigner", blockNumber: finalized.number }),
        source.readContract({ address: record.recoveryVault as Address, abi: sourceAbi, functionName: "riskSigner", blockNumber: finalized.number }),
      ]);
      if (routeSigner.toLowerCase() !== config.routeSigner.address.toLowerCase()
        || currentRiskSigner.toLowerCase() !== config.riskSigner.toLowerCase()) {
        throw new Error("recovery-refund-signer-mismatch");
      }
      const routeSignature = await config.routeSigner.signTypedData(refundTypedData(record));
      const args = [record.operationId as Hex, record.refundTxHash as Hex, BigInt(record.amount),
        BigInt(record.nonce), BigInt(record.deadline), routeSignature, record.riskSignature as Hex] as const;
      await source.simulateContract({ address: record.recoveryVault as Address, abi: sourceAbi,
        functionName: "recordSourceRefund", args, account: config.funder.address });
      const [latestNonce, pendingNonce] = await Promise.all([
        source.getTransactionCount({ address: config.funder.address, blockTag: "latest" }),
        source.getTransactionCount({ address: config.funder.address, blockTag: "pending" }),
      ]);
      const prior = record.priorAttempts?.filter((attempt) => attempt.sourceNonce !== undefined
        && attempt.sourceNonce >= latestNonce).sort((a, b) => a.sourceNonce! - b.sourceNonce!)[0];
      const nonce = prior?.sourceNonce ?? pendingNonce;
      const wallet = createWalletClient({ account: config.funder, transport: http(rpc) });
      const request = await wallet.prepareTransactionRequest({
        account: config.funder, chain: null, to: record.recoveryVault as Address,
        data: encodeFunctionData({ abi: sourceAbi, functionName: "recordSourceRefund", args }), nonce,
      });
      const feeRequest = request as typeof request & {
        gasPrice?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint;
      };
      const oldFee = max(bump(prior?.gasPrice), bump(prior?.maxFeePerGas));
      const feeOverride = feeRequest.gasPrice !== undefined
        ? { gasPrice: max(feeRequest.gasPrice, oldFee) }
        : { maxFeePerGas: max(max(feeRequest.maxFeePerGas ?? 0n, oldFee),
          bump(prior?.maxPriorityFeePerGas)),
          maxPriorityFeePerGas: max(feeRequest.maxPriorityFeePerGas ?? 0n,
            bump(prior?.maxPriorityFeePerGas)) };
      await assertKeeperFunding(source, config.funder.address, { ...request, ...feeOverride });
      const rawTx = await wallet.signTransaction({ ...request, ...feeOverride, chain: null } as never);
      const txHash = keccak256(rawTx);
      await refundRepo.prepare(record.refundTxHash, claim.token, txHash, rawTx, nonce);
      record.txHash = txHash;
      record.rawTx = rawTx;
      record.sourceNonce = nonce;
      persisted = true;
    }
    if (!record.txHash || !record.rawTx || !word.test(record.txHash)
      || keccak256(record.rawTx as Hex).toLowerCase() !== record.txHash.toLowerCase()) {
      throw new Error("recovery-refund-signed-transaction-invalid");
    }
    let receipt = await source.getTransactionReceipt({ hash: record.txHash as Hex }).catch(() => null);
    if (!receipt) {
      try {
        await assertSignedKeeperFunding(source, record.rawTx as Hex);
        const submitted = await source.sendRawTransaction({ serializedTransaction: record.rawTx as Hex });
        if (submitted.toLowerCase() !== record.txHash.toLowerCase()) throw new Error("recovery-refund-tx-hash-mismatch");
        await refundRepo.state(record.refundTxHash, claim.token, "submitted");
      } catch (error) {
        if (!(error instanceof Error) || !/already known|known transaction|nonce too low/i.test(error.message)) throw error;
      }
      receipt = await source.waitForTransactionReceipt({ hash: record.txHash as Hex, timeout: 60_000 }).catch(() => null);
    }
    if (!receipt) {
      const currentNonce = await source.getTransactionCount({ address: config.funder.address, blockTag: "latest" });
      if (record.sourceNonce !== undefined && currentNonce > record.sourceNonce) {
        await refundRepo.state(record.refundTxHash, claim.token, "manual_review", { failure: "recovery-refund-tx-replaced" });
        await recoveryRepo.releaseFunder(record.sourceChain, config.funder.address, signerLock);
      }
      return false;
    }
    const finalized = await source.getBlock({ blockTag: "finalized" });
    if (receipt.blockNumber > finalized.number) {
      await refundRepo.state(record.refundTxHash, claim.token, "mined");
      return false;
    }
    const canonical = await source.getBlock({ blockNumber: receipt.blockNumber });
    if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()
      || canonical.transactions[receipt.transactionIndex]?.toLowerCase() !== record.txHash.toLowerCase()
      || receipt.transactionHash.toLowerCase() !== record.txHash.toLowerCase()) return false;
    if (!recordedLog(receipt, record)) {
      await refundRepo.state(record.refundTxHash, claim.token, "manual_review", { failure: "recovery-refund-record-tx-mismatch" });
      await recoveryRepo.releaseFunder(record.sourceChain, config.funder.address, signerLock);
      return true;
    }
    const used = await source.readContract({ address: record.recoveryVault as Address, abi: sourceAbi,
      functionName: "usedRefundTxHash", args: [record.refundTxHash as Hex], blockNumber: finalized.number });
    if (!used) throw new Error("recovery-refund-unrecorded");
    await refundRepo.state(record.refundTxHash, claim.token, "confirmed", { sourceBlockHash: receipt.blockHash });
    await recoveryRepo.releaseFunder(record.sourceChain, config.funder.address, signerLock);
    return true;
  } finally {
    await refundRepo.release(refundTxHash, claim.token);
    if (acquired && !persisted) await recoveryRepo.releaseFunder(record.sourceChain, config.funder.address, signerLock);
  }
}

export async function runRecoveryRefundWorker(): Promise<number> {
  if (!recoveryConfig() || running) return 0;
  running = true;
  let completed = 0;
  try {
    const records = await refundRepo.listPending();
    for (const record of records) {
      try {
        if (await reconcileRefund(String(record.refundTxHash))) completed += 1;
      } catch (error) {
        logger.warn("recovery-refund-reconciliation-failed", {
          refundTxHash: record.refundTxHash,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  } finally {
    running = false;
  }
  return completed;
}
