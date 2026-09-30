import type { FastifyInstance } from "fastify";
import { collateralController } from "./collateral.controller.js";

export function collateralRoute(app: FastifyInstance): void {
  app.post("/collateral/topups/plan", collateralController.planTopUp);
  app.post("/collateral/topups/confirmation-plan", collateralController.confirmTopUp);
  app.post("/collateral", collateralController.track);
  app.get("/collateral", collateralController.list);
  app.post("/collateral/solana", collateralController.trackSolana);
  app.get("/collateral/solana", collateralController.listSolana);
  app.post("/collateral/solana/actions/plan", collateralController.planSolanaAction);
  app.get("/collateral/solana/actions/plan", collateralController.readSolanaActionPlan);
  app.get("/collateral/solana/actions/confirmation-plan", collateralController.readSolanaConfirmationPlan);
  app.post("/collateral/solana/actions/confirmation-plan", collateralController.planSolanaConfirmation);
  app.post("/collateral/solana/recovery/funding-plan", collateralController.planSolanaRecoveryFunding);
  app.post("/collateral/solana/recovery/confirmation-plan", collateralController.planSolanaRecoveryFundingConfirmation);
  app.post("/collateral/solana/recovery/payout-confirmation-plan", collateralController.planSolanaRecoveryPayoutConfirmation);
  app.post("/collateral/solana/recovery/payout-plan", collateralController.planSolanaRecoveryPayout);
  app.post("/collateral/solana/recovery/refund-reconciliation-plan", collateralController.planSolanaRecoveryRefundReconciliation);
  app.post("/collateral/actions", collateralController.scheduleAction);
  app.get("/collateral/actions", collateralController.listActions);
  app.post("/collateral/actions/source-tx", collateralController.attachSourceTx);
  app.post("/collateral/actions/cancel", collateralController.prepareCancel);
}
