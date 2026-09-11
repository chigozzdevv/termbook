import type { FastifyInstance } from "fastify";
import { authController } from "./auth.controller.js";

export function authRoute(app: FastifyInstance): void {
  app.post("/auth/nonce", authController.nonce);
}
