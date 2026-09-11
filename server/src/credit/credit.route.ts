import type { FastifyInstance } from "fastify";
import { creditController } from "./credit.controller.js";

export function creditRoute(app: FastifyInstance): void {
  app.post("/credits", creditController.track);
  app.get("/credits/:id", creditController.get);
  app.get("/credits/:id/positions", creditController.positions);
  app.get("/credits/:id/pending", creditController.pending);
}
