import type { FastifyInstance } from "fastify";
import { collateralController } from "./collateral.controller.js";

export function collateralRoute(app: FastifyInstance): void {
  app.post("/collateral", collateralController.track);
  app.get("/collateral", collateralController.list);
}
