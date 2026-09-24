import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { intentRepo } from "./intent.repo.js";
import type { intentSchema } from "./intent.schema.js";

export const intentService = {
  async create(input: z.infer<typeof intentSchema>, bundleId: string, actionFunding = 0n) {
    const intentId = `0x${randomBytes(32).toString("hex")}`;
    const expiresAt = Math.floor(Date.now() / 1000) + input.duration;
    await intentRepo.create({ intentId, ...input, bundleId, actionFunding: actionFunding.toString(), expiresAt, status: "open", used: false });
    return { intentId, ...input, bundleId, actionFunding: actionFunding.toString(), expiresAt, status: "open" };
  },
  async get(intentId: string) {
    return intentRepo.get(intentId);
  },
};
