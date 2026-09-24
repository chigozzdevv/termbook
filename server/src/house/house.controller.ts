import type { FastifyRequest } from "fastify";
import { houseSchema } from "./house.schema.js";
import { houseService } from "./house.service.js";
import { authService } from "../auth/auth.service.js";
import { z } from "zod";

export const houseController = {
  async register(req: FastifyRequest) {
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user || !authService.isAdmin(user.wallet)) throw new Error("permission-denied");
    return houseService.register(houseSchema.parse(req.body));
  },
  async list() {
    return houseService.list();
  },
  async intents(req: FastifyRequest) {
    const input = z.object({ house: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      cursor: z.object({ createdAt: z.iso.datetime(), id: z.string().regex(/^[a-fA-F0-9]{24}$/) }).optional() }).parse(req.body);
    const user = (req as FastifyRequest & { user?: { wallet: string } }).user;
    if (!user) throw new Error("permission-denied");
    return houseService.intents(input.house, user.wallet, input.cursor
      ? { createdAt: new Date(input.cursor.createdAt), id: input.cursor.id } : undefined);
  },
};
