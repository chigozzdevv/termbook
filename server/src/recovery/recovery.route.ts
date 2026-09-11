import type { FastifyInstance } from "fastify";
import { recoveryController } from "./recovery.controller.js";

export function recoveryRoute(app: FastifyInstance): void {
  app.post("/recovery", recoveryController.open);
  app.get("/recovery", recoveryController.list);
}
