import type { FastifyInstance } from "fastify";
import { paymentRoutes } from "./aurora.client.js";
import { settlementController } from "./settlement.controller.js";

export function settlementRoute(app: FastifyInstance): void {
  app.get("/settlement/routes", async () => paymentRoutes());
  app.post("/settlement", settlementController.register);
  app.get("/settlement/:id", settlementController.get);
}
