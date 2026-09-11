import type { FastifyRequest } from "fastify";
import { recoverySchema } from "./recovery.schema.js";
import { recoveryService } from "./recovery.service.js";

export const recoveryController = {
  async open(req: FastifyRequest) {
    return recoveryService.open(recoverySchema.parse(req.body));
  },
  async list(req: FastifyRequest<{ Querystring: { creditId: string } }>) {
    return recoveryService.list(req.query.creditId);
  },
};
