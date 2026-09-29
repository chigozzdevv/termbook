import type { FastifyRequest } from "fastify";
import { collateralSchema } from "./collateral.schema.js";
import { collateralService } from "./collateral.service.js";
import { z } from "zod";
import { cancelRemoteActionSchema, remoteActionSchema, remoteActionSourceTxSchema } from "./remote-action.schema.js";
import { remoteActionService } from "./remote-action.service.js";
import { solanaTrackSchema } from "./solana.schema.js";
import { solanaService } from "./solana.service.js";
import { solanaActionPlanSchema, solanaConfirmationPlanSchema } from "./solana-action.schema.js";
import { solanaActionService } from "./solana-action.service.js";
import { solanaRecoveryFundingConfirmationSchema, solanaRecoveryFundingPlanSchema,
  solanaRecoveryPayoutConfirmationSchema, solanaRecoveryRefundReconciliationSchema } from "./solana-recovery.schema.js";
import { solanaRecoveryService } from "./solana-recovery.service.js";
import { solanaRecoveryPayoutPlanSchema } from "./solana-payout.schema.js";
import { solanaPayoutService } from "./solana-payout.service.js";

export const collateralController = {
  async track(req: FastifyRequest) {
    const input = collateralSchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || user.wallet.toLowerCase() !== input.owner.toLowerCase()) throw new Error("permission-denied");
    return collateralService.track(input);
  },
  async list(req: FastifyRequest<{ Querystring: { creditId: string } }>) {
    return collateralService.list(z.string().regex(/^0x[a-fA-F0-9]{64}$/).parse(req.query.creditId).toLowerCase());
  },
  async trackSolana(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return solanaService.track(solanaTrackSchema.parse(req.body), user.wallet);
  },
  async listSolana(req: FastifyRequest<{ Querystring: { creditId: string } }>) {
    const creditId = z.string().regex(/^0x[a-fA-F0-9]{64}$/).parse(req.query.creditId);
    return solanaService.list(creditId);
  },
  async planSolanaAction(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return solanaActionService.plan(solanaActionPlanSchema.parse(req.body), user.wallet);
  },
  async readSolanaActionPlan(req: FastifyRequest) {
    return solanaActionService.plan(solanaActionPlanSchema.parse(req.query));
  },
  async readSolanaConfirmationPlan(req: FastifyRequest) {
    return solanaActionService.confirmationPlan(solanaConfirmationPlanSchema.parse(req.query));
  },
  async planSolanaConfirmation(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return solanaActionService.confirmationPlan(solanaConfirmationPlanSchema.parse(req.body), user.wallet);
  },
  async planSolanaRecoveryFunding(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return solanaRecoveryService.fundingPlan(solanaRecoveryFundingPlanSchema.parse(req.body), user.wallet);
  },
  async planSolanaRecoveryFundingConfirmation(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return solanaRecoveryService.confirmationPlan(solanaRecoveryFundingConfirmationSchema.parse(req.body), user.wallet);
  },
  async planSolanaRecoveryPayoutConfirmation(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return solanaRecoveryService.confirmationPlan(
      solanaRecoveryPayoutConfirmationSchema.parse(req.body), user.wallet, "payout",
    );
  },
  async planSolanaRecoveryPayout(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return solanaPayoutService.plan(solanaRecoveryPayoutPlanSchema.parse(req.body), user.wallet);
  },
  async planSolanaRecoveryRefundReconciliation(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return solanaRecoveryService.refundReconciliationPlan(
      solanaRecoveryRefundReconciliationSchema.parse(req.body), user.wallet,
    );
  },
  async scheduleAction(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return remoteActionService.schedule(remoteActionSchema.parse(req.body), user.wallet as `0x${string}`);
  },
  async listActions(req: FastifyRequest<{ Querystring: { creditId: string } }>) {
    const creditId = z.string().regex(/^0x[a-fA-F0-9]{64}$/).parse(req.query.creditId);
    return remoteActionService.list(creditId);
  },
  async attachSourceTx(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return remoteActionService.attachSourceTx(remoteActionSourceTxSchema.parse(req.body), user.wallet as `0x${string}`);
  },
  async prepareCancel(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return remoteActionService.prepareExpiredActionCancel(cancelRemoteActionSchema.parse(req.body), user.wallet as `0x${string}`);
  },
};
