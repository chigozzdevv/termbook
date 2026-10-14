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
import { runRiskWorker } from "./risk/risk.worker.js";
import { riskKeeper, riskScanConfig } from "./risk/risk.config.js";
import { runRecoveryRelayWorker } from "./recovery/relay.worker.js";
import { recoveryRelayConfig } from "./recovery/relay.config.js";
import { runKeeperWorker } from "./chain/keeper.worker.js";
import { runExecutionWorker } from "./integration/execution.worker.js";
import { runSolanaRelayWorker } from "./collateral/solana-relay.worker.js";
import { solanaRelayConfig } from "./collateral/solana-relay.config.js";
import { ratioFeedConfig, runOracleWorker } from "./chain/oracle.worker.js";
import { assertEnvioConfig } from "./chain/envio.client.js";
import { runUpgradeMonitorWorker, upgradeMonitorConfig } from "./integration/upgrade-monitor.worker.js";
import { priceReferenceConfig, runPriceReferenceWorker } from "./chain/price-reference.worker.js";
import { pythOracleConfig } from "./chain/pyth.client.js";
import { runPythOracleWorker } from "./chain/pyth.worker.js";
import { startIndexAndMonitor } from "./chain/services.js";
import { runExplorerWorker } from "./explorer/explorer.worker.js";
import { closeRpcBudget } from "./chain/rpc.budget.js";
import { runTestnetHouseOffers, testnetOfferConfig } from "./house/testnet-offers.worker.js";
import { kuruLiquidityConfig, runKuruLiquidityWorker } from "./kuru/liquidity.worker.js";

async function main(): Promise<void> {
  if (process.argv.includes("--indexer-monitor")) { await startIndexAndMonitor(); return; }
  assertRuntimeConfig();
  assertEnvioConfig();
  assertSettlementWorkerConfig();
  assertRecoveryWorkerConfig();
  indexerStart();
  riskKeeper();
  riskScanConfig();
  ratioFeedConfig();
  priceReferenceConfig();
  pythOracleConfig();
  upgradeMonitorConfig();
  recoveryRelayConfig();
  solanaProofConfig();
  await solanaRelayConfig();
  testnetOfferConfig();
  kuruLiquidityConfig();
  await connectDb();
  await startWorkers();
  const tick = async (): Promise<void> => {
    await runPythOracleWorker();
    const results = await Promise.allSettled([
      runCreditWorker(),
      runCollateralWorker(),
      runRemoteActionWorker(),
      runSolanaLockWorker(),
      runEthereumBeaconWorker(),
      runSettlementWorker(),
      runRecoveryWorker(),
      runRecoveryRelayWorker(),
      runRecoveryRefundWorker(),
      runOracleWorker(),
      runKuruLiquidityWorker(),
      runExplorerWorker(),
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
  let indexerTimer: ReturnType<typeof setTimeout> | undefined;
  let indexerActive: Promise<void> | undefined;
  let riskTimer: ReturnType<typeof setTimeout> | undefined;
  let riskActive: Promise<void> | undefined;
  let actionTimer: ReturnType<typeof setTimeout> | undefined;
  let actionActive: Promise<void> | undefined;
  let keeperTimer: ReturnType<typeof setTimeout> | undefined;
  let keeperActive: Promise<void> | undefined;
  let solanaTimer: ReturnType<typeof setTimeout> | undefined;
  let solanaActive: Promise<void> | undefined;
  let upgradeTimer: ReturnType<typeof setTimeout> | undefined;
  let upgradeActive: Promise<void> | undefined;
  let priceTimer: ReturnType<typeof setTimeout> | undefined;
  let priceActive: Promise<void> | undefined;
  let offerTimer: ReturnType<typeof setTimeout> | undefined;
  let offerActive: Promise<void> | undefined;
  const scheduleOffers = (): void => {
    if (stopping) return;
    offerActive = runTestnetHouseOffers().then(() => undefined).catch(() => {
      logger.warn("house-offer-worker-unavailable");
    }).finally(() => { if (!stopping) offerTimer = setTimeout(scheduleOffers, 5000); });
  };
  const schedule = (): void => {
    if (stopping) return;
    active = tick().finally(() => {
      if (!stopping) timer = setTimeout(schedule, 15_000);
    });
  };
  const scheduleRisk = (): void => {
    if (stopping) return;
    riskActive = runRiskWorker().then(() => undefined).catch((error: unknown) => {
      logger.error("risk-monitor-failed", { reason: error instanceof Error ? error.message : "unknown" });
    }).finally(() => {
      if (!stopping) riskTimer = setTimeout(scheduleRisk, 5_000);
    });
  };
  const scheduleIndexer = (): void => {
    if (stopping) return;
    indexerActive = runIndexerWorker().then(() => undefined).catch((error: unknown) => {
      logger.error("indexer-failed", { reason: error instanceof Error ? error.message : "unknown" });
    }).finally(() => {
      if (!stopping) indexerTimer = setTimeout(scheduleIndexer, 5_000);
    });
  };
  const scheduleKeepers = (): void => {
    if (stopping) return;
    keeperActive = runKeeperWorker().then(() => undefined).catch((error: unknown) => {
      logger.error("keeper-reconciliation-failed", { reason: error instanceof Error ? error.message : "unknown" });
    }).finally(() => {
      if (!stopping) keeperTimer = setTimeout(scheduleKeepers, 5_000);
    });
  };
  const scheduleActions = (): void => {
    if (stopping) return;
    actionActive = runExecutionWorker().then(() => undefined).catch(() => {
      logger.error("execution-monitor-failed");
    }).finally(() => {
      if (!stopping) actionTimer = setTimeout(scheduleActions, 5_000);
    });
  };
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    clearTimeout(indexerTimer);
    clearTimeout(riskTimer);
    clearTimeout(keeperTimer);
    clearTimeout(actionTimer);
    clearTimeout(solanaTimer);
    clearTimeout(upgradeTimer);
    clearTimeout(priceTimer);
    clearTimeout(offerTimer);
    await Promise.all([active, indexerActive, riskActive, keeperActive, actionActive, solanaActive, upgradeActive, priceActive, offerActive]);
    await stopWorkers();
    await closeRedis();
    await closeRpcBudget();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  schedule();
  if (testnetOfferConfig().length) scheduleOffers();
  scheduleIndexer();
  scheduleRisk();
  scheduleKeepers();
  scheduleActions();
  const scheduleUpgradeMonitor = (): void => {
    if (stopping) return;
    upgradeActive = runUpgradeMonitorWorker().then(() => undefined).catch(() => {
      logger.error("upgrade-monitor-failed");
    }).finally(() => { if (!stopping) upgradeTimer = setTimeout(scheduleUpgradeMonitor, 5_000); });
  };
  scheduleUpgradeMonitor();
  const schedulePrices = (): void => {
    if (stopping) return;
    priceActive = runPriceReferenceWorker().then(() => undefined).catch(() => {
      logger.error("price-reference-monitor-failed");
    }).finally(() => { if (!stopping) priceTimer = setTimeout(schedulePrices, 5_000); });
  };
  schedulePrices();
  const scheduleSolana = (): void => {
    if (stopping) return;
    solanaActive = runSolanaRelayWorker().then(() => undefined).catch(() => {
      logger.error("solana-source-relay-unavailable");
    }).finally(() => { if (!stopping) solanaTimer = setTimeout(scheduleSolana, 5_000); });
  };
  scheduleSolana();
}

void main();
