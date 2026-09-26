import type { FastifyInstance } from "fastify";
import { integrationController } from "./integration.controller.js";
import { applicationController } from "./application.controller.js";

export function integrationRoute(app: FastifyInstance): void {
  app.post("/applications", applicationController.register);
  app.post("/applications/:id/verify-origin", applicationController.verify);
  app.post("/applications/:id/details", applicationController.details);
  app.post("/integrations", integrationController.approve);
  app.post("/integrations/draft", integrationController.draft);
  app.post("/integrations/candidates/:id/mapping", integrationController.map);
  app.post("/integrations/candidates/:id/evidence", integrationController.evidence);
  app.post("/integrations/candidates/:id/details", integrationController.candidate);
  app.get("/integrations", integrationController.list);
  app.get("/integrations/config", integrationController.resolve);
}
