import { createPublicClient, http, parseAbi, recoverTypedDataAddress, type Hex } from "viem";
import { z } from "zod";
import { HttpError } from "../http/http.errors.js";
import { settlementRepo } from "../settlement/settlement.repo.js";
import { RecoveryModel } from "./recovery.model.js";
import { recoveryConfig } from "./recovery.config.js";
import { refundRepo } from "./refund.repo.js";
import { refundDigest, refundTypedData, verifyFinalizedRefund, type RefundRecord } from "./refund.plan.js";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const operationSchema = z.object({
  operationId: word, creditId: word, kind: z.literal("recovery"),
  sourceChain: z.number().int().positive(), sourceAsset: address,
  sourceRefundRecipient: address,
});
const signerAbi = parseAbi([
  "function routeSigner() view returns (address)",
  "function riskSigner() view returns (address)",
]);

export type RefundPlanInput = { operationId: string; creditId: string; refundTxHash: string };

async function plan(input: RefundPlanInput, wallet: string) {
  const config = recoveryConfig();
  if (!config || wallet.toLowerCase() !== config.riskSigner.toLowerCase()) {
    throw new HttpError(403, "recovery-risk-signer-required");
  }
  const saved = await settlementRepo.get(input.operationId.toLowerCase());
  if (!saved) throw new HttpError(404, "recovery-operation-not-found");
  const operation = operationSchema.parse(saved);
  if (operation.creditId.toLowerCase() !== input.creditId.toLowerCase()) {
    throw new HttpError(409, "recovery-credit-mismatch");
  }
  const funding = await RecoveryModel.findOne({ operationId: operation.operationId, state: "confirmed" }).lean();
  if (!funding || String(funding.creditId).toLowerCase() !== input.creditId.toLowerCase()
    || Number(funding.sourceChain) !== operation.sourceChain
    || String(funding.recoveryVault).toLowerCase() !== operation.sourceRefundRecipient.toLowerCase()) {
    throw new HttpError(409, "recovery-funding-not-confirmed");
  }
  const rpcUrl = config.sourceRpcs[operation.sourceChain];
  if (!rpcUrl) throw new HttpError(503, "recovery-source-rpc-unavailable");
  const base: RefundRecord = {
    operationId: operation.operationId.toLowerCase(), creditId: operation.creditId.toLowerCase(),
    refundTxHash: input.refundTxHash.toLowerCase(), sourceChain: operation.sourceChain,
    recoveryVault: operation.sourceRefundRecipient.toLowerCase(), asset: operation.sourceAsset.toLowerCase(),
    amount: "", nonce: "1", deadline: 0, refundDigest: "", riskSigner: config.riskSigner.toLowerCase(),
  };
  const evidence = await verifyFinalizedRefund(base, rpcUrl);
  const source = createPublicClient({ transport: http(rpcUrl) });
  const finalizedBlock = await source.getBlock({ blockTag: "finalized" });
  const finalized = finalizedBlock.number;
  const [routeSigner, riskSigner] = await Promise.all([
    source.readContract({ address: base.recoveryVault as `0x${string}`, abi: signerAbi, functionName: "routeSigner", blockNumber: finalized }),
    source.readContract({ address: base.recoveryVault as `0x${string}`, abi: signerAbi, functionName: "riskSigner", blockNumber: finalized }),
  ]);
  if (routeSigner.toLowerCase() !== config.routeSigner.address.toLowerCase()
    || riskSigner.toLowerCase() !== config.riskSigner.toLowerCase()) {
    throw new HttpError(409, "recovery-source-signer-mismatch");
  }
  const now = Math.floor(Date.now() / 1000);
  const deadline = Math.max(now, Number(finalizedBlock.timestamp)) + 7 * 86_400;
  if (!Number.isSafeInteger(deadline)) throw new HttpError(409, "recovery-refund-deadline-invalid");
  const record: RefundRecord = { ...base, amount: evidence.amount.toString(), deadline };
  record.refundDigest = refundDigest(record);
  const existing = await refundRepo.get(record.refundTxHash);
  if (existing?.state === "confirmed") throw new HttpError(409, "recovery-refund-already-recorded");
  let opened = await refundRepo.open(record);
  if (opened.deadline <= now) {
    if (finalizedBlock.timestamp <= BigInt(opened.deadline)) {
      throw new HttpError(409, "recovery-refund-awaiting-expiry-finality");
    }
    if (opened.txHash) {
      const previous = await source.getTransactionReceipt({ hash: opened.txHash as Hex }).catch(() => null);
      if (previous && previous.blockNumber > finalized) {
        throw new HttpError(409, "recovery-refund-awaiting-transaction-finality");
      }
      if (previous?.status === "success") {
        const canonical = await source.getBlock({ blockNumber: previous.blockNumber });
        if (canonical.hash.toLowerCase() === previous.blockHash.toLowerCase()
          && canonical.transactions[previous.transactionIndex]?.toLowerCase() === opened.txHash.toLowerCase()
          && previous.transactionHash.toLowerCase() === opened.txHash.toLowerCase()) {
          throw new HttpError(409, "recovery-refund-awaiting-reconciliation");
        }
      }
    }
    opened = await refundRepo.renew(opened as RefundRecord, deadline);
  }
  if (opened.deadline <= now + 120) throw new HttpError(409, "recovery-refund-approval-expiring");
  const typedData = refundTypedData(opened as RefundRecord);
  return {
    record: opened as RefundRecord,
    typedData,
    refundDigest: refundDigest(opened as RefundRecord),
    sourceTransfer: {
      token: base.asset, vault: base.recoveryVault, sender: evidence.sender,
      txHash: base.refundTxHash, amount: evidence.amount.toString(),
      blockNumber: evidence.blockNumber.toString(), blockHash: evidence.blockHash,
      blockTimestamp: evidence.timestamp.toString(),
    },
    providerEvidence: {
      status: saved.providerStatus ?? null,
      statusCheckedAt: saved.providerStatusCheckedAt ?? null,
      refundedAmount: saved.providerRefundedAmount ?? null,
      originTxHashes: saved.providerOriginTxHashes ?? [],
      destinationTxHashes: saved.providerDestinationTxHashes ?? [],
      depositAddress: funding.depositAddress ?? null,
      quoteHash: funding.quoteHash ?? null,
    },
  };
}

export const refundService = {
  async riskApprovalPlan(input: RefundPlanInput, wallet: string) {
    const result = await plan(input, wallet);
    return {
      operationId: result.record.operationId, creditId: result.record.creditId,
      refundTxHash: result.record.refundTxHash, recoveryVault: result.record.recoveryVault,
      amount: result.record.amount, riskSigner: result.record.riskSigner,
      refundDigest: result.refundDigest, deadline: result.record.deadline,
      sourceTransfer: result.sourceTransfer, providerEvidence: result.providerEvidence,
      attribution: "external-risk-signer-approval-required",
      typedData: {
        ...result.typedData,
        message: Object.fromEntries(Object.entries(result.typedData.message).map(([key, value]) =>
          [key, typeof value === "bigint" ? value.toString() : value])),
      },
    };
  },
  async approveRisk(input: RefundPlanInput & { signature: string }, wallet: string) {
    const result = await plan(input, wallet);
    let signer: `0x${string}`;
    try {
      signer = await recoverTypedDataAddress({ ...result.typedData, signature: input.signature as Hex });
    } catch {
      throw new HttpError(403, "recovery-refund-signature-invalid");
    }
    if (signer.toLowerCase() !== result.record.riskSigner.toLowerCase()) {
      throw new HttpError(403, "recovery-refund-signature-invalid");
    }
    await refundRepo.approve(result.record.refundTxHash, result.refundDigest, input.signature);
    return { operationId: result.record.operationId, refundTxHash: result.record.refundTxHash, state: "approved" };
  },
  async list(creditId: string) {
    return refundRepo.list(creditId.toLowerCase());
  },
};
