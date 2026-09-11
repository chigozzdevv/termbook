import type { FastifyInstance } from "fastify";
import { catalogController } from "./catalog.controller.js";

export function catalogRoute(app: FastifyInstance): void {
  app.get("/catalog", catalogController.overview);
}
