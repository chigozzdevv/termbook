import type { FastifyRequest } from "fastify";
import { houseSchema } from "./house.schema.js";
import { houseService } from "./house.service.js";
import { authService } from "../auth/auth.service.js";

export const houseController = {
  async register(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || !authService.isAdmin(user.wallet)) throw new Error("permission-denied");
    return houseService.register(houseSchema.parse(req.body));
  },
  async list() {
    return houseService.list();
  },
};
