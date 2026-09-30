import { encodeFunctionData, parseAbi, type Hex, type PublicClient } from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
import { monadClient } from "../chain/monad.client.js";
import { keeperTransaction } from "../chain/keeper.js";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { riskKeeper, riskScanConfig } from "../risk/risk.config.js";
import { riskRepo } from "../risk/risk.repo.js";

const state = "(bytes32 positionId,uint256 committed,uint256 filled,uint256 refunded,uint256 remaining,uint256 liability,uint256 maxLiability,uint256 deadline,uint256 observedAt,uint8 positionSlots,address refundRecipient,uint8 status)";
const coreAbi = parseAbi([
  "function managedBundle(bytes32) view returns (bool)",
  "function executionManager() view returns (address)",
  "function actionHealthBlocked(bytes32) view returns (bool)",
  "function syncActions(bytes32)",
  "function riskEngine() view returns (address)",
  "function previewHealth(bytes32) view returns ((uint256 debt,uint256 cash,uint256 sourceValue,int256 appValue,uint16 retainedSource,uint16 retainedApp,uint128 recoveryCosts,uint256 recoveryValue,uint256 healthBps))",
]);
const managerAbi = parseAbi([
  "function bundles(bytes32) view returns (address policy,address reader,bytes32 policyCodeHash,bytes32 readerCodeHash,bytes32 policyHash,uint8 maxPositions,uint8 maxPending,uint32 maxAge)",
  "function pendingCount(bytes32) view returns (uint256)",
  "function pendingAt(bytes32,uint256) view returns (bytes32)",
  "function breached(bytes32) view returns (bool)",
  `function records(bytes32,bytes32) view returns (bytes32 capability,bytes32 market,uint256 exposureLimit,uint8 reservedSlots,${state} state)`,
]);
const policyAbi = parseAbi([`function pendingState(bytes32,address,bytes32) view returns (${state})`]);
const riskAbi = parseAbi(["function initialBps(bytes32) view returns (uint256)"]);
let running = false;
let nextShard = 0;

export function pendingAccountingEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return Object.keys(left).filter((key) => key !== "observedAt").every((key) =>
    String(left[key]).toLowerCase() === String(right[key]).toLowerCase());
}

export async function reconcileActions(chain: PublicClient, creditId: Hex, blockNumber: bigint,
  keeper: ReturnType<typeof riskKeeper>, ensureLease?: () => Promise<void>): Promise<void> {
  const core = env.core as Hex;
  const credit = await chain.readContract({ address: core, abi: termbookCoreAbi,
    functionName: "creditDetails", args: [creditId], blockNumber });
  if (![4, 5, 8, 9].includes(credit.facility) || !await chain.readContract({ address: core, abi: coreAbi,
    functionName: "managedBundle", args: [credit.bundleId], blockNumber })) return;
  const manager = await chain.readContract({ address: core, abi: coreAbi, functionName: "executionManager", blockNumber });
  const [bundle, count, blocked] = await Promise.all([
    chain.readContract({ address: manager, abi: managerAbi, functionName: "bundles", args: [credit.bundleId], blockNumber }),
    chain.readContract({ address: manager, abi: managerAbi, functionName: "pendingCount", args: [creditId], blockNumber }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "actionHealthBlocked", args: [creditId], blockNumber }),
  ]);
  if (count > BigInt(bundle[6]) || count > 32n) throw new Error("execution-pending-bounds");
  let changed = false;
  for (let index = 0n; index < count; ++index) {
    const id = await chain.readContract({ address: manager, abi: managerAbi,
      functionName: "pendingAt", args: [creditId, index], blockNumber });
    const [record, current] = await Promise.all([
      chain.readContract({ address: manager, abi: managerAbi, functionName: "records", args: [creditId, id], blockNumber }),
      chain.readContract({ address: bundle[0], abi: policyAbi, functionName: "pendingState",
        args: [creditId, credit.account, id], blockNumber }),
    ]);
    if (!pendingAccountingEqual(record[4], current)) changed = true;
  }
  if (!keeper || !changed && !blocked) return;
  if (!changed) {
    if (await chain.readContract({ address: manager, abi: managerAbi, functionName: "breached", args: [creditId], blockNumber })) return;
    const risk = await chain.readContract({ address: core, abi: coreAbi, functionName: "riskEngine", blockNumber });
    const [health, initial] = await Promise.all([
      chain.readContract({ address: core, abi: coreAbi, functionName: "previewHealth", args: [creditId], blockNumber }),
      chain.readContract({ address: risk, abi: riskAbi, functionName: "initialBps", args: [creditId], blockNumber }),
    ]);
    if (initial === 0n || health.healthBps < initial) return;
  }
  await chain.simulateContract({ address: core, abi: coreAbi, functionName: "syncActions",
    args: [creditId], account: keeper.address, blockNumber });
  await ensureLease?.();
  const result = await keeperTransaction({ client: chain, rpcUrl: env.rpcUrl, chainId: env.monadChainId,
    account: keeper, operation: `${creditId}:${credit.revision}:sync:${blockNumber}`, to: core,
    data: encodeFunctionData({ abi: coreAbi, functionName: "syncActions", args: [creditId] }) });
  if (result === "reverted") throw new Error("execution-reconciliation-reverted");
}

export async function runExecutionWorker(): Promise<number> {
  if (running) return 0;
  const config = riskScanConfig();
  running = true;
  const cursor = `${env.monadChainId}:${env.core.toLowerCase()}:actions`;
  let scan: Awaited<ReturnType<typeof riskRepo.claim>> = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lost = false;
  try {
    const chain = monadClient();
    if (await chain.getChainId() !== env.monadChainId) throw new Error("execution-chain-mismatch");
    const block = await chain.getBlock({ blockTag: "finalized" });
    for (let attempt = 0; attempt < config.shards && !scan; ++attempt) scan = await riskRepo.claim(cursor, nextShard++ % config.shards, config.shards);
    if (!scan) return 0;
    const lease = scan;
    heartbeat = setInterval(() => { void riskRepo.renew(lease.id, lease.lease).then((ok) => { if (!ok) lost = true; })
      .catch(() => { lost = true; }); }, 30_000);
    heartbeat.unref();
    const credits = await riskRepo.page(scan, config.pageSize);
    const keeper = riskKeeper();
    for (let offset = 0; offset < credits.length; offset += config.concurrency) {
      if (lost) throw new Error("execution-scan-lease-lost");
      await Promise.all(credits.slice(offset, offset + config.concurrency).map(async (id) => {
        try { await reconcileActions(chain, id as Hex, block.number, keeper, async () => {
          if (lost || !await riskRepo.renew(lease.id, lease.lease)) throw new Error("execution-scan-lease-lost");
        }); }
        catch { logger.warn("execution-reconciliation-unavailable", { creditId: id, block: block.number.toString() }); }
      }));
    }
    if (lost) throw new Error("execution-scan-lease-lost");
    await riskRepo.advance(scan, credits.at(-1) ?? "", block.number.toString(), credits.length < config.pageSize);
    return credits.length;
  } finally { clearInterval(heartbeat); try { if (scan) await riskRepo.release(scan.id, scan.lease); } finally { running = false; } }
}
