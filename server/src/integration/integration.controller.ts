import type { FastifyRequest } from "fastify";
import { integrationAcceptanceSchema, integrationDraftRequestSchema, integrationMappingSchema } from "./integration.schema.js";
import { candidateService } from "./candidate.service.js";
import { integrationService } from "./integration.service.js";
import { authService } from "../auth/auth.service.js";
import { applicationIdSchema } from "./application.schema.js";
import { z } from "zod";
import { acceptanceCases } from "@termbook/schema";

export const integrationController = {
  async approve(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || !authService.isAdmin(user.wallet)) throw new Error("permission-denied");
    const input = z.strictObject({ candidateId: applicationIdSchema,
      forkReviewSignature: z.string().regex(/^0x[a-fA-F0-9]{130}$/).optional() }).parse(req.body);
    return candidateService.publish(input.candidateId, user.wallet, input.forkReviewSignature as `0x${string}` | undefined);
  },
  async draft(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return candidateService.create(integrationDraftRequestSchema.parse(req.body), user.wallet);
  },
  async map(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    const params = req.params as { id?: string };
    return candidateService.map(applicationIdSchema.parse(params.id), user.wallet,
      integrationMappingSchema.parse(req.body));
  },
  async evidence(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    const params = req.params as { id?: string };
    return candidateService.evidence(applicationIdSchema.parse(params.id), user.wallet,
      integrationAcceptanceSchema.parse(req.body));
  },
  async candidate(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    const params = req.params as { id?: string };
    return candidateService.details(applicationIdSchema.parse(params.id), user.wallet);
  },
  async list() {
    return integrationService.list();
  },
  async requirements() { return { format: 1, cases: acceptanceCases }; },
  async resolve(req: FastifyRequest) {
    const query = req.query as { app_token?: string };
    return integrationService.resolve(String(query.app_token ?? ""));
  },
};
