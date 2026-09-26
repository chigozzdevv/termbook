import { randomBytes, randomUUID } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";
import { applicationRepo } from "./application.repo.js";
import { env } from "../config/env.js";
import type { applicationSchema } from "./application.schema.js";
import type { z } from "zod";

function normalizeOrigin(value: string): { origin: string; host: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("application-origin-invalid"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.origin !== value || url.port || url.username || url.password
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
    || isIP(host)
    || /\.(?:local|localhost|internal|invalid|test|example)$/.test(host)) {
    throw new Error("application-origin-invalid");
  }
  return { origin: url.origin, host };
}

async function hasOriginProof(host: string, challenge: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      resolveTxt(`_termbook.${host}`),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error()), 5_000); }),
    ]);
    return records.some((parts) => parts.join("") === `termbook=${challenge}`);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const applicationService = {
  async register(input: z.infer<typeof applicationSchema>, owner: string) {
    if (input.chainId !== env.monadChainId || !/^0x[a-fA-F0-9]{40}$/.test(owner)
      || /^0x0{40}$/i.test(owner)) {
      throw new Error("application-owner-invalid");
    }
    const { origin, host } = normalizeOrigin(input.origin);
    const id = randomUUID();
    const challenge = randomBytes(32).toString("hex");
    const challengeExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await applicationRepo.create({ id, name: input.name, origin, chainId: input.chainId,
        owner: owner.toLowerCase(), challenge, challengeExpiresAt });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        throw new Error("application-conflict", { cause: error });
      }
      throw error;
    }
    return { id, origin, owner: owner.toLowerCase(), status: "draft", verification: {
      record: `_termbook.${host}`, value: `termbook=${challenge}`, expiresAt: challengeExpiresAt.toISOString(),
    } };
  },
  async verify(id: string, owner: string) {
    const app = await applicationRepo.get(id);
    if (!app || app["owner"] !== owner.toLowerCase()) throw new Error("application-not-found");
    if (app["verifiedAt"]) return { id, status: "verified" };
    if (!(app["challengeExpiresAt"] instanceof Date) || app["challengeExpiresAt"].getTime() <= Date.now()) {
      throw new Error("application-challenge-expired");
    }
    const { host } = normalizeOrigin(String(app["origin"]));
    if (!await hasOriginProof(host, String(app["challenge"]))) {
      throw new Error("application-origin-unverified");
    }
    const updated = await applicationRepo.verify(id, owner.toLowerCase(), String(app["challenge"]), new Date());
    if (!updated) throw new Error("application-challenge-expired");
    return { id, status: "verified" };
  },
  async details(id: string, owner: string) {
    const app = await applicationRepo.get(id);
    if (!app || app["owner"] !== owner.toLowerCase()) throw new Error("application-not-found");
    const verified = Boolean(app["verifiedAt"]);
    const { host } = normalizeOrigin(String(app["origin"]));
    return { id, name: String(app["name"]), origin: String(app["origin"]),
      chainId: Number(app["chainId"]), owner: String(app["owner"]),
      status: verified ? "verified" : "draft", verification: verified ? undefined : {
        record: `_termbook.${host}`, value: `termbook=${app["challenge"]}`,
        expiresAt: (app["challengeExpiresAt"] as Date).toISOString(),
      } };
  },
  async requireVerified(id: string, owner?: string, fresh = false) {
    const app = await applicationRepo.get(id);
    if (!app || !app["verifiedAt"] || app["chainId"] !== env.monadChainId
      || owner && app["owner"] !== owner.toLowerCase()) throw new Error("application-not-verified");
    if (fresh) {
      const { host } = normalizeOrigin(String(app["origin"]));
      if (!await hasOriginProof(host, String(app["challenge"]))) {
        throw new Error("application-origin-unverified");
      }
    }
    return { id, owner: String(app["owner"]), origin: String(app["origin"]), chainId: Number(app["chainId"]) };
  },
};
