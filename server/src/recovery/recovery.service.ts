import type { z } from "zod";
import { createPublicClient, hashTypedData, http, parseAbi, recoverTypedDataAddress } from "viem";
import { HttpError } from "../http/http.errors.js";
import { settlementRepo } from "../settlement/settlement.repo.js";
import { recoveryFundingPlan, recoveryFundingTypedData, verifyRoute } from "./recovery.plan.js";
import { recoveryConfig } from "./recovery.config.js";
import { recoveryRepo } from "./recovery.repo.js";
import { verifyRegisteredRecoveryOperation } from "./recovery.worker.js";
import type { recoveryRiskApprovalPlanSchema, recoveryRiskApprovalSchema } from "./recovery.schema.js";

const sourceAbi = parseAbi([
  "function riskSigner() view returns (address)",
  "function held(bytes32) view returns (uint256)",
]);

type PlanInput = z.infer<typeof recoveryRiskApprovalPlanSchema>;

async function riskPlan(input: PlanInput) {
  const config = recoveryConfig();
  if (!config) throw new HttpError(503, "recovery-unavailable");
  const saved = await settlementRepo.get(input.operationId);
  if (!saved) throw new HttpError(404, "recovery-operation-not-found");
  const { operation, record, funding, digest } = recoveryFundingPlan(saved);
  if (operation.creditId.toLowerCase() !== input.creditId.toLowerCase()) throw new HttpError(409, "recovery-credit-mismatch");
  if (operation.providerStatus && operation.providerStatus !== "PENDING_DEPOSIT") {
    throw new HttpError(409, "recovery-route-already-active");
  }
  if (record.deadline * 1000 <= Date.now() + 120_000) throw new HttpError(409, "recovery-quote-expired");
  verifyRoute(operation);
  await verifyRegisteredRecoveryOperation(operation, digest);
  const sourceRpc = config.sourceRpcs[operation.sourceChain];
  if (!sourceRpc) throw new HttpError(503, "recovery-source-rpc-unavailable");
  const source = createPublicClient({ transport: http(sourceRpc) });
  if (await source.getChainId() !== operation.sourceChain) throw new HttpError(503, "recovery-source-chain-mismatch");
  const blockNumber = (await source.getBlock({ blockTag: "finalized" })).number;
  const vault = operation.sourceRefundRecipient as `0x${string}`;
  const [signer, held] = await Promise.all([
    source.readContract({ address: vault, abi: sourceAbi, functionName: "riskSigner", blockNumber }),
    source.readContract({ address: vault, abi: sourceAbi, functionName: "held", args: [funding.creditId], blockNumber }),
  ]);
  if (signer.toLowerCase() !== config.riskSigner.toLowerCase() || held < funding.amount) {
    throw new HttpError(409, "recovery-source-binding-mismatch");
  }
  const typedData = recoveryFundingTypedData(operation, funding);
  return { operation, funding, config, typedData, fundingDigest: hashTypedData(typedData) };
}

export const recoveryService = {
  async riskApprovalPlan(input: PlanInput) {
    const plan = await riskPlan(input);
    return {
      operationId: plan.operation.operationId,
      riskSigner: plan.config.riskSigner,
      fundingDigest: plan.fundingDigest,
      typedData: {
        ...plan.typedData,
        message: Object.fromEntries(Object.entries(plan.typedData.message).map(([key, value]) =>
          [key, typeof value === "bigint" ? value.toString() : value])),
      },
    };
  },
  async approveRisk(input: z.infer<typeof recoveryRiskApprovalSchema>, wallet: string) {
    const config = recoveryConfig();
    if (!config) throw new HttpError(503, "recovery-unavailable");
    if (wallet.toLowerCase() !== config.riskSigner.toLowerCase()) throw new HttpError(403, "recovery-risk-signer-required");
    const plan = await riskPlan(input);
    let recovered: `0x${string}`;
    try {
      recovered = await recoverTypedDataAddress({ ...plan.typedData, signature: input.signature as `0x${string}` });
    } catch {
      throw new HttpError(403, "recovery-risk-signature-invalid");
    }
    if (recovered.toLowerCase() !== config.riskSigner.toLowerCase()) {
      throw new HttpError(403, "recovery-risk-signature-invalid");
    }
    await recoveryRepo.approveRisk({
      _id: plan.operation.operationId.toLowerCase(), creditId: plan.operation.creditId.toLowerCase(),
      fundingDigest: plan.fundingDigest, riskSigner: config.riskSigner.toLowerCase(),
      signature: input.signature, deadline: Number(plan.funding.deadline),
    });
    return { operationId: plan.operation.operationId, fundingDigest: plan.fundingDigest, state: "approved" };
  },
  async list(creditId: string) {
    return recoveryRepo.list(creditId.toLowerCase());
  },
};
