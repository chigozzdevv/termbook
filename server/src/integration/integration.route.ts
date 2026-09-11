import type { FastifyInstance } from "fastify";
import { integrationController } from "./integration.controller.js";

export function integrationRoute(app: FastifyInstance): void {
  app.post("/integrations", integrationController.approve);
  app.get("/integrations", integrationController.list);
}
