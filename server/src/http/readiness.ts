import mongoose from "mongoose";
import { IndexCursorModel } from "../chain/indexer.model.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";

export async function readiness(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1) return false;
  const cursor = await IndexCursorModel.findById(`${env.monadChainId}:${env.core.toLowerCase()}`).lean();
  if (!cursor || cursor["integrityFailure"] || !(cursor["indexedAt"] instanceof Date)
    || Date.now() - cursor["indexedAt"].getTime() > 60_000) return false;
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) return false;
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  return BigInt(String(cursor["nextBlock"])) > finalized.number - 500n;
}
