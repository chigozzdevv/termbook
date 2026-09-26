import type { FastifyRequest } from "fastify";
import { applicationIdSchema, applicationSchema } from "./application.schema.js";
import { applicationService } from "./application.service.js";

function owner(req: FastifyRequest): string {
  const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
  if (!user) throw new Error("permission-denied");
  return user.wallet;
}

export const applicationController = {
  async register(req: FastifyRequest) {
    return applicationService.register(applicationSchema.parse(req.body), owner(req));
  },
  async verify(req: FastifyRequest) {
    const params = req.params as { id?: string };
    return applicationService.verify(applicationIdSchema.parse(params.id), owner(req));
  },
  async details(req: FastifyRequest) {
    const params = req.params as { id?: string };
    return applicationService.details(applicationIdSchema.parse(params.id), owner(req));
  },
};
