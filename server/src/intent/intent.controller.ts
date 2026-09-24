import type { FastifyRequest } from "fastify";
import { intentSchema } from "./intent.schema.js";
import { intentService } from "./intent.service.js";
import { integrationService } from "../integration/integration.service.js";

export const intentController = {
  async create(req: FastifyRequest) {
    const input = intentSchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || user.wallet.toLowerCase() !== input.borrower.toLowerCase()) throw new Error("permission-denied");
    const appToken = req.headers["x-termbook-app-token"];
    if (typeof appToken !== "string") throw new Error("integration-not-found");
    const integration = await integrationService.resolve(appToken);
    return intentService.create(input, integration.versionId);
  },
  async get(req: FastifyRequest<{ Params: { id: string } }>) {
    return intentService.get(req.params.id);
  },
};
