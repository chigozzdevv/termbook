import type { FastifyRequest } from "fastify";
import { settlementSchema } from "./settlement.schema.js";
import { settlementService } from "./settlement.service.js";

export const settlementController = {
  async register(req: FastifyRequest) {
    const input = settlementSchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || user.wallet.toLowerCase() !== input.payer.toLowerCase()) throw new Error("permission-denied");
    return settlementService.register(input);
  },
  async get(req: FastifyRequest<{ Params: { id: string } }>) {
    return settlementService.get(req.params.id);
  },
};
