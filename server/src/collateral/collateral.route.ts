import type { FastifyInstance } from "fastify";
import { collateralController } from "./collateral.controller.js";

export function collateralRoute(app: FastifyInstance): void {
  app.post("/collateral", collateralController.track);
  app.get("/collateral", collateralController.list);
  app.post("/collateral/actions", collateralController.scheduleAction);
  app.get("/collateral/actions", collateralController.listActions);
  app.post("/collateral/actions/source-tx", collateralController.attachSourceTx);
  app.post("/collateral/actions/cancel", collateralController.prepareCancel);
}
