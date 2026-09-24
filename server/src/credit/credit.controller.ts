import type { FastifyRequest } from "fastify";
import { creditSchema } from "./credit.schema.js";
import { creditService } from "./credit.service.js";
import { z } from "zod";

export const creditController = {
  async track(req: FastifyRequest) {
    const input = creditSchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || user.wallet.toLowerCase() !== input.borrower.toLowerCase()) throw new Error("permission-denied");
    return creditService.track(input);
  },
  async get(req: FastifyRequest<{ Params: { id: string } }>) {
    return creditService.get(req.params.id);
  },
  async list(req: FastifyRequest<{ Querystring: { borrower: string } }>) {
    return creditService.list(z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse(req.query.borrower));
  },
  async positions(req: FastifyRequest<{ Params: { id: string } }>) {
    const credit = await creditService.get(req.params.id) as { positions?: unknown[] } | null;
    if (!credit) throw new Error("credit-not-found");
    return Array.isArray(credit.positions) ? credit.positions : [];
  },
  async pending(req: FastifyRequest<{ Params: { id: string } }>) {
    const credit = await creditService.get(req.params.id) as { pending?: unknown[] } | null;
    if (!credit) throw new Error("credit-not-found");
    return Array.isArray(credit.pending) ? credit.pending : [];
  },
};
