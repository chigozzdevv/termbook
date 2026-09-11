import type { FastifyRequest } from "fastify";
import { intentSchema } from "./intent.schema.js";
import { intentService } from "./intent.service.js";

export const intentController = {
  async create(req: FastifyRequest) {
    const input = intentSchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || user.wallet.toLowerCase() !== input.borrower.toLowerCase()) throw new Error("permission-denied");
    return intentService.create(input);
  },
  async get(req: FastifyRequest<{ Params: { id: string } }>) {
    return intentService.get(req.params.id);
  },
};
