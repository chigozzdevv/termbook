import mongoose from "mongoose";
import { IndexCursorModel } from "../chain/indexer.model.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { riskRepo } from "../risk/risk.repo.js";
import { riskScanConfig } from "../risk/risk.config.js";

export async function readiness(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) return false;
  const cursor = await IndexCursorModel.findById(`${env.monadChainId}:${env.core.toLowerCase()}`).lean();
  if (!cursor || cursor["integrityFailure"] || !(cursor["indexedAt"] instanceof Date)
    || Date.now() - cursor["indexedAt"].getTime() > 60_000) return false;
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) return false;
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (BigInt(String(cursor["nextBlock"])) <= finalized.number - 500n) return false;
  const config = riskScanConfig();
  const key = `${env.monadChainId}:${env.core.toLowerCase()}`;
  const scans = await Promise.all([riskRepo.scanHealthy(key, config.shards, config.maxAgeMs),
    riskRepo.scanHealthy(`${key}:actions`, config.shards, config.maxAgeMs)]);
  return scans.every(Boolean);
}
