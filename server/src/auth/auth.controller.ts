import type { FastifyRequest } from "fastify";
import { authSchema } from "./auth.schema.js";
import { authService } from "./auth.service.js";

export const authController = {
  async nonce(req: FastifyRequest) {
    const body = authSchema.parse(req.body);
    return authService.nonce(body.wallet, { method: body.method, path: body.path, bodyHash: body.bodyHash });
  },
};
