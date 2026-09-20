import type { FastifyRequest } from "fastify";
import { settlementSchema } from "./settlement.schema.js";
import { settlementService } from "./settlement.service.js";
import { deriveOperationId } from "./operation-id.js";

export const settlementController = {
  async register(req: FastifyRequest) {
    const input = settlementSchema.parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || user.wallet.toLowerCase() !== input.payer.toLowerCase()) throw new Error("permission-denied");
    const expected = deriveOperationId({
      kind: input.kind,
      payer: input.payer,
      nonce: BigInt(input.nonce),
      chainId: input.sourceChain,
      creditId: input.creditId,
      routeVersion: input.routeVersion,
      sourceAsset: input.sourceAsset,
      vault: input.vault,
    });
    if (expected.toLowerCase() !== input.operationId.toLowerCase()) throw new Error("operation-id-mismatch");
    return settlementService.register(input);
  },
  async get(req: FastifyRequest<{ Params: { id: string } }>) {
    return settlementService.get(req.params.id);
  },
};
