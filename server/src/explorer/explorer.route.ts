import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addressSchema, bytes32Schema } from "@termbook/schema";
import { requestLimiter } from "../http/http-limit.js";
import { HttpError } from "../http/http.errors.js";
import { explorerService } from "./explorer.service.js";

export function explorerRoute(app: FastifyInstance): void {
  const limit = requestLimiter(60, 60_000);
  app.register(async (routes) => {
    routes.addHook("onRequest", async (req, reply) => {
      if (!limit(req.ip)) return reply.status(429).header("retry-after", "60").send({ error: "explorer-rate-limited" });
    });
    routes.setErrorHandler((error, _req, reply) => {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: "validation-failed" });
      if (error instanceof HttpError) return reply.status(error.status).send({ error: error.message });
      return reply.status(503).send({ error: "explorer-unavailable" });
    });
    routes.get("/explorer/orders", async (req) => {
      const query = z.object({ cursor: bytes32Schema.optional() }).parse(req.query);
      return explorerService.orders(query.cursor?.toLowerCase());
    });
    routes.get<{ Params: { id: string } }>("/explorer/orders/:id", async (req, reply) => {
      const row = await explorerService.order(bytes32Schema.parse(req.params.id).toLowerCase());
      return row ?? reply.status(404).send({ error: "order-not-found" });
    });
    routes.get("/explorer/houses", async () => explorerService.houses());
    routes.get<{ Params: { address: string } }>("/explorer/houses/:address", async (req, reply) => {
      const row = await explorerService.house(addressSchema.parse(req.params.address).toLowerCase());
      return row ?? reply.status(404).send({ error: "house-not-found" });
    });
  });
}
