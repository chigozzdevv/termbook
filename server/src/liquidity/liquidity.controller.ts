import type { FastifyRequest } from "fastify";
import { liquiditySchema } from "./liquidity.schema.js";
import { liquidityService } from "./liquidity.service.js";

export const liquidityController = {
  async deposit(req: FastifyRequest) {
    const input = liquiditySchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || user.wallet.toLowerCase() !== input.depositor.toLowerCase()) throw new Error("permission-denied");
    return liquidityService.deposit(input);
  },
  async list(req: FastifyRequest<{ Querystring: { house: string } }>) {
    return liquidityService.list(req.query.house);
  },
};
