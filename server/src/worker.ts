import { connectDb } from "./database/database.client.js";
import { runCreditWorker } from "./credit/credit.worker.js";
import { runCollateralWorker } from "./collateral/collateral.worker.js";
import { runRemoteActionWorker } from "./collateral/remote-action.worker.js";
import { runSolanaLockWorker } from "./collateral/solana.worker.js";
import { runEthereumBeaconWorker } from "./chain/ethereum-beacon.worker.js";
import { solanaProofConfig } from "./collateral/solana.config.js";
import { runSettlementWorker } from "./settlement/settlement.worker.js";
import { runRecoveryWorker } from "./recovery/recovery.worker.js";
import { runRecoveryRefundWorker } from "./recovery/refund.worker.js";
import { assertRecoveryWorkerConfig } from "./recovery/recovery.config.js";
import { startWorkers, stopWorkers } from "./queue/queue.worker.js";
import { closeRedis } from "./queue/queue.client.js";
import { logger } from "./logging/logger.js";
import { assertRuntimeConfig, assertSettlementWorkerConfig } from "./config/env.js";
import mongoose from "mongoose";
import { indexerStart, runIndexerWorker } from "./chain/indexer.worker.js";

async function main(): Promise<void> {
  assertRuntimeConfig();
  assertSettlementWorkerConfig();
  assertRecoveryWorkerConfig();
  indexerStart();
  solanaProofConfig();
  await connectDb();
  await startWorkers();
  const tick = async (): Promise<void> => {
    const results = await Promise.allSettled([
      runIndexerWorker(),
      runCreditWorker(),
      runCollateralWorker(),
      runRemoteActionWorker(),
      runSolanaLockWorker(),
      runEthereumBeaconWorker(),
      runSettlementWorker(),
      runRecoveryWorker(),
      runRecoveryRefundWorker(),
    ]);
    const counts = results.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      logger.warn("worker-tick-failed", { index, reason: result.reason instanceof Error ? result.reason.message : "unknown" });
      return 0;
    });
    logger.info(`workers-tick:${counts.join(",")}`);
  };
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  const schedule = (): void => {
    if (stopping) return;
    active = tick().finally(() => {
      if (!stopping) timer = setTimeout(schedule, 15_000);
    });
  };
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    await active;
    await stopWorkers();
    await closeRedis();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  schedule();
}

void main();
