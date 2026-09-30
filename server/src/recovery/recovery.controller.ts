import type { FastifyRequest } from "fastify";
import { recoveryRiskApprovalPlanSchema, recoveryRiskApprovalSchema, recoveryRefundApprovalSchema, recoveryRefundPlanSchema, returnHeldPrepareSchema } from "./recovery.schema.js";
import { recoveryService } from "./recovery.service.js";
import { prepareHeldReturn } from "./return-held.service.js";
import { refundService } from "./refund.service.js";
import { recoveryClearanceSchema } from "./recovery.schema.js";
import { recoveryClearancePlan } from "./clearance.service.js";

export const recoveryController = {
  async clearancePlan(req: FastifyRequest) {
    const wallet = (req as FastifyRequest & { user?: { wallet: string } }).user?.wallet;
    if (!wallet) throw new Error("permission-denied");
    const input = recoveryClearanceSchema.parse(req.body);
    return recoveryClearancePlan({ ...input, creditId: input.creditId as `0x${string}` }, wallet as `0x${string}`);
  },
  async riskApprovalPlan(req: FastifyRequest) {
    return recoveryService.riskApprovalPlan(recoveryRiskApprovalPlanSchema.parse(req.query));
  },
  async approveRisk(req: FastifyRequest) {
    const wallet = (req as FastifyRequest & { user?: { wallet: string } }).user?.wallet;
    return recoveryService.approveRisk(recoveryRiskApprovalSchema.parse(req.body), wallet ?? "");
  },
  async refundApprovalPlan(req: FastifyRequest) {
    const wallet = (req as FastifyRequest & { user?: { wallet: string } }).user?.wallet;
    return refundService.riskApprovalPlan(recoveryRefundPlanSchema.parse(req.body), wallet ?? "");
  },
  async approveRefund(req: FastifyRequest) {
    const wallet = (req as FastifyRequest & { user?: { wallet: string } }).user?.wallet;
    return refundService.approveRisk(recoveryRefundApprovalSchema.parse(req.body), wallet ?? "");
  },
  async listRefunds(req: FastifyRequest<{ Querystring: { creditId: string } }>) {
    return refundService.list(recoveryRiskApprovalPlanSchema.shape.creditId.parse(req.query.creditId));
  },
  async list(req: FastifyRequest<{ Querystring: { creditId: string } }>) {
    return recoveryService.list(req.query.creditId);
  },
  async prepareHeldReturn(req: FastifyRequest) {
    const wallet = (req as FastifyRequest & { user?: { wallet: string } }).user?.wallet;
    if (!wallet) throw new Error("permission-denied");
    const input = returnHeldPrepareSchema.parse(req.body);
    return prepareHeldReturn(input as { creditId: `0x${string}`; authorizationTxHash: `0x${string}` }, wallet as `0x${string}`);
  },
};
