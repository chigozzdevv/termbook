import type { FastifyInstance } from "fastify";
import { recoveryController } from "./recovery.controller.js";

export function recoveryRoute(app: FastifyInstance): void {
  app.get("/recovery/risk-approval-plan", recoveryController.riskApprovalPlan);
  app.post("/recovery/risk-approval", recoveryController.approveRisk);
  app.post("/recovery/refund/plan", recoveryController.refundApprovalPlan);
  app.post("/recovery/refund/approve", recoveryController.approveRefund);
  app.get("/recovery/refunds", recoveryController.listRefunds);
  app.get("/recovery", recoveryController.list);
  app.post("/recovery/return-held/prepare", recoveryController.prepareHeldReturn);
}
