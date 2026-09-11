import type { FastifyInstance } from "fastify";
import { quoteController } from "./quote.controller.js";

export function quoteRoute(app: FastifyInstance): void {
  app.get("/quotes", quoteController.offers);
  app.post("/quotes", quoteController.record);
}
