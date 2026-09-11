import type { FastifyInstance } from "fastify";
import { liquidityController } from "./liquidity.controller.js";

export function liquidityRoute(app: FastifyInstance): void {
  app.post("/liquidity", liquidityController.deposit);
  app.get("/liquidity", liquidityController.list);
}
