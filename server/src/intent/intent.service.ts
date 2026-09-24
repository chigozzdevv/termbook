import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { intentRepo } from "./intent.repo.js";
import type { intentSchema } from "./intent.schema.js";
import { constants } from "../config/constants.js";

export const intentService = {
  async create(input: z.infer<typeof intentSchema>, bundleId: string, actionFunding: bigint, settlementAsset: string) {
    if (!settlementAsset || !/^0x[a-fA-F0-9]{40}$/.test(settlementAsset) || /^0x0{40}$/i.test(settlementAsset)) {
      throw new Error("settlement-asset-unavailable");
    }
    const intentId = `0x${randomBytes(32).toString("hex")}`;
    const expiresAt = Math.floor(Date.now() / 1000) + constants.intentLifetimeSeconds;
    await intentRepo.create({ intentId, ...input, bundleId, settlementAsset: settlementAsset.toLowerCase(),
      actionFunding: actionFunding.toString(), expiresAt, status: "open", used: false });
    return { intentId, ...input, bundleId, settlementAsset: settlementAsset.toLowerCase(),
      actionFunding: actionFunding.toString(), expiresAt, status: "open" };
  },
  async get(intentId: string) {
    return intentRepo.get(intentId);
  },
  async listOpen(settlementAsset: string, cursor?: { createdAt: Date; id: string }) {
    return intentRepo.listOpen(settlementAsset.toLowerCase(), cursor);
  },
};
