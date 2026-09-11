import { randomBytes } from "node:crypto";
import { intentRepo } from "./intent.repo.js";

export const intentService = {
  async create(input: {
    borrower: string;
    chainId: number;
    asset: string;
    amount: string;
    owner?: string;
    recipient?: string;
    duration: number;
    limit?: string;
    action?: Record<string, unknown>;
  }) {
    const intentId = `0x${randomBytes(32).toString("hex")}`;
    const expiresAt = Math.floor(Date.now() / 1000) + input.duration;
    await intentRepo.create({ intentId, ...input, expiresAt, status: "open", used: false });
    return { intentId, ...input, expiresAt, status: "open" };
  },
  async get(intentId: string) {
    return intentRepo.get(intentId);
  },
};
