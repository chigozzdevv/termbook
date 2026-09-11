import type { FastifyRequest } from "fastify";
import { collateralSchema } from "./collateral.schema.js";
import { collateralService } from "./collateral.service.js";

export const collateralController = {
  async track(req: FastifyRequest) {
    const input = collateralSchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || user.wallet.toLowerCase() !== input.owner.toLowerCase()) throw new Error("permission-denied");
    return collateralService.track(input);
  },
  async list(req: FastifyRequest<{ Querystring: { creditId: string } }>) {
    return collateralService.list(req.query.creditId);
  },
};
