import { connectDb } from "./database/database.client.js";
import { runCreditWorker } from "./credit/credit.worker.js";
import { runCollateralWorker } from "./collateral/collateral.worker.js";
import { runSettlementWorker } from "./settlement/settlement.worker.js";
import { runRecoveryWorker } from "./recovery/recovery.worker.js";
import { startWorkers, stopWorkers } from "./queue/queue.worker.js";
import { closeRedis } from "./queue/queue.client.js";
import { logger } from "./logging/logger.js";
import { assertRuntimeConfig } from "./config/env.js";

async function main(): Promise<void> {
  assertRuntimeConfig();
  await connectDb();
  await startWorkers();
  const tick = async (): Promise<void> => {
    const counts = await Promise.all([
      runCreditWorker(),
      runCollateralWorker(),
      runSettlementWorker(),
      runRecoveryWorker(),
    ]);
    logger.info(`workers-tick:${counts.join(",")}`);
  };
  await tick();
  const timer = setInterval(() => void tick(), 15_000);
  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await stopWorkers();
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main();
