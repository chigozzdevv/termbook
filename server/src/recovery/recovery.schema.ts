import { z } from "zod";

export const recoveryRiskApprovalPlanSchema = z.object({
  creditId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  operationId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export const recoveryRiskApprovalSchema = recoveryRiskApprovalPlanSchema.extend({
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});

export const recoveryRefundPlanSchema = recoveryRiskApprovalPlanSchema.extend({
  refundTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export const recoveryRefundApprovalSchema = recoveryRefundPlanSchema.extend({
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});

export const returnHeldPrepareSchema = z.object({
  creditId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  authorizationTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export const recoveryClearanceSchema = z.object({
  creditId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  sourceTx: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/).optional(),
});
