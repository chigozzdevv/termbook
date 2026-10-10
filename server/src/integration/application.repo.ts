import { ApplicationModel } from "./application.model.js";

export const applicationRepo = {
  async create(input: { id: string; name: string; origin: string; chainId: number; owner: string;
    challenge: string; challengeExpiresAt: Date }) {
    return ApplicationModel.create(input);
  },
  async get(id: string) {
    return ApplicationModel.findOne({ id }).lean();
  },
  async verify(id: string, owner: string, challenge: string, now: Date) {
    return ApplicationModel.findOneAndUpdate({ id, owner, challenge,
      challengeExpiresAt: { $gt: now } }, { $set: { verifiedAt: now } }, { returnDocument: "after" }).lean();
  },
};
