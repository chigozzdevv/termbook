import type { FastifyInstance } from "fastify";
import { settlementController } from "./settlement.controller.js";

export function settlementRoute(app: FastifyInstance): void {
  app.post("/settlement", settlementController.register);
  app.get("/settlement/:id", settlementController.get);
}
