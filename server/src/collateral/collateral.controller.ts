import type { FastifyRequest } from "fastify";
import { collateralSchema } from "./collateral.schema.js";
import { collateralService } from "./collateral.service.js";
import { z } from "zod";
import { cancelRemoteActionSchema, remoteActionSchema, remoteActionSourceTxSchema } from "./remote-action.schema.js";
import { remoteActionService } from "./remote-action.service.js";

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
