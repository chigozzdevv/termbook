import "dotenv/config";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { createPublicClient, http, type Hex } from "viem";
import { connectDb } from "../../src/database/database.client.js";
import { replaceKeeperTransaction } from "../../src/chain/keeper-replacement.js";
import { env } from "../../src/config/env.js";

async function main() {
  const [chain, wallet, file] = process.argv.slice(2);
  const rpc = chain === String(env.monadChainId) ? env.rpcUrl : chain === "1" ? env.sourceRpcUrl : "";
  if (!rpc || !wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet) || !file) {
    throw new Error("Usage: replace-keeper-tx <chain-id> <wallet> <signed-transaction-file>");
  }
  const raw = (await readFile(file, "utf8")).trim() as Hex;
  try {
    await connectDb();
    const hash = await replaceKeeperTransaction(createPublicClient({ transport: http(rpc) }),
      `${chain}:${wallet.toLowerCase()}`, raw);
    process.stdout.write(`${hash}\n`);
  } finally { await mongoose.disconnect(); }
}
try { await main(); }
catch (error) {
  const message = error instanceof Error && (/^keeper-[a-z-]+$/.test(error.message) || error.message.startsWith("Usage:"))
    ? error.message : "keeper-replacement-failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
