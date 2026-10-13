import mongoose from "mongoose";
import { connectDb } from "../database/database.client.js";
import { closeRedis } from "../queue/queue.client.js";
import { assertEnvioConfig } from "./envio.client.js";
import { indexerStart, runIndexerWorker } from "./indexer.worker.js";
import { runUpgradeMonitorWorker, upgradeMonitorConfig } from "../integration/upgrade-monitor.worker.js";
import { logger } from "../logging/logger.js";
import { runExplorerWorker } from "../explorer/explorer.worker.js";
import { closeRpcBudget } from "./rpc.budget.js";

export async function startIndexAndMonitor(): Promise<void> {
  assertEnvioConfig(); indexerStart(); upgradeMonitorConfig();
  await connectDb();
  let stopping = false;
  const active = new Set<Promise<void>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function schedule(task: () => Promise<number>, name: string) {
    if (stopping) return;
    const work = task().then(() => undefined).catch((error: unknown) => {
      logger.warn(`${name}-failed`, { reason: error instanceof Error ? error.message.split("\n")[0] : "unknown" });
    }).finally(() => {
      active.delete(work);
      if (!stopping) {
        const timer = setTimeout(() => { timers.delete(timer); schedule(task, name); }, 5_000);
        timers.add(timer);
      }
    });
    active.add(work);
  }
  const stop = () => {
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    void Promise.allSettled([...active]).then(async () => { await closeRedis(); await closeRpcBudget(); await mongoose.disconnect(); });
  };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  schedule(runIndexerWorker, "indexer");
  schedule(runUpgradeMonitorWorker, "upgrade-monitor");
  schedule(runExplorerWorker, "explorer");
  logger.info("indexer-and-upgrade-monitor-started");
}
