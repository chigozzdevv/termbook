import type { FastifyRequest } from "fastify";
import { integrationSchema } from "./integration.schema.js";
import { integrationService } from "./integration.service.js";
import { authService } from "../auth/auth.service.js";

export const integrationController = {
  async approve(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || !authService.isAdmin(user.wallet)) throw new Error("permission-denied");
    return integrationService.approve(integrationSchema.parse(req.body));
  },
  async list() {
    return integrationService.list();
  },
  async resolve(req: FastifyRequest) {
    const query = req.query as { app_token?: string };
    return integrationService.resolve(String(query.app_token ?? ""));
  },
};
