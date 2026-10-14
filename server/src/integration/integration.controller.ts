import type { FastifyRequest } from "fastify";
import { integrationAcceptanceSchema, integrationDraftRequestSchema, integrationMappingSchema } from "./integration.schema.js";
import { candidateService } from "./candidate.service.js";
import { integrationService } from "./integration.service.js";
import { authService } from "../auth/auth.service.js";
import { applicationIdSchema } from "./application.schema.js";
import { z } from "zod";
import { acceptanceCases } from "@termbook/schema";
import { pluginDefinitionSchema } from "@termbook/schema";
import { packageService } from "./package.service.js";
import { platformService } from "./platform.service.js";

export const integrationController = {
  async useCasePlatform() { return platformService.useCase(); },
  async spotPlatform() { return platformService.spot(); },
  async source(req: FastifyRequest) {
    const input = z.strictObject({ target: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(req.query);
    return platformService.source(input.target as `0x${string}`);
  },
  async validatePackage(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    const input = z.strictObject({ application_id: applicationIdSchema, definition: pluginDefinitionSchema,
      acceptance: integrationAcceptanceSchema }).parse(req.body);
    return packageService.validate(input.application_id, user.wallet, input.definition, input.acceptance);
  },
  async registerPackage(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    const input = z.strictObject({ application_id: applicationIdSchema, validation_id: applicationIdSchema }).parse(req.body);
    return packageService.register(input.validation_id, input.application_id, user.wallet);
  },
  async approvePackage(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || !authService.isAdmin(user.wallet)) throw new Error("permission-denied");
    const input = z.strictObject({ validation_id: applicationIdSchema,
      fork_review_signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/).optional() }).parse(req.body);
    return packageService.approve(input.validation_id, user.wallet as `0x${string}`, input.fork_review_signature as `0x${string}` | undefined);
  },
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
    return integrationService.resolve(String(query.app_token ?? ""), false, "connection");
  },
};
