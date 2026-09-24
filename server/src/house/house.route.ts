import type { FastifyInstance } from "fastify";
import { houseController } from "./house.controller.js";

export function houseRoute(app: FastifyInstance): void {
  app.post("/houses", houseController.register);
  app.get("/houses", houseController.list);
  app.post("/houses/intents", houseController.intents);
}
