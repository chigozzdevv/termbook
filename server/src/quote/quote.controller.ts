import type { FastifyRequest } from "fastify";
import { quoteService } from "./quote.service.js";
import { quoteSchema } from "./quote.schema.js";

export const quoteController = {
  async offers(req: FastifyRequest<{ Querystring: { intentId: string } }>) {
    return quoteService.offers(req.query.intentId);
  },
  async record(req: FastifyRequest) {
    const input = quoteSchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return quoteService.record(input);
  },
};
