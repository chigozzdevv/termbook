import type { FastifyInstance } from "fastify";
import { intentController } from "./intent.controller.js";

export function intentRoute(app: FastifyInstance): void {
  app.post("/intents", intentController.create);
  app.get("/intents/:id", intentController.get);
}
