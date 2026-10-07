import type { FastifyRequest } from "fastify";
import { intentSchema } from "./intent.schema.js";
import { intentService } from "./intent.service.js";
import { integrationService } from "../integration/integration.service.js";
import { actionFunding } from "@termbook/schema";
import { validateActionCall } from "../integration/validate-action.js";
import { actionFundingBound } from "../integration/integration.price.js";

export const intentController = {
  async create(req: FastifyRequest) {
    const input = intentSchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || user.wallet.toLowerCase() !== input.borrower.toLowerCase()) throw new Error("permission-denied");
    const appToken = req.headers["x-termbook-app-token"];
    if (typeof appToken !== "string") throw new Error("integration-not-found");
    const integration = await integrationService.resolve(appToken);
    const definition = input.action && integration.actions.find((action) => action.capability === input.action!.capability);
    if (input.action && !definition) throw new Error("capability-denied");
    const bound = input.action && definition ? await actionFundingBound(integration.versionId as `0x${string}`, definition, input.action) : undefined;
    const funding = input.action && definition ? actionFunding(definition, input.action, bound) : 0n;
    if (input.action && definition) validateActionCall(definition, input.action, input.borrower as `0x${string}`);
    if (input.limit && BigInt(input.limit) < funding) throw new Error("credit-limit-insufficient");
    return intentService.create(input, integration.versionId, funding, integration.settlementAsset);
  },
  async get(req: FastifyRequest<{ Params: { id: string } }>) {
    return intentService.get(req.params.id);
  },
};
