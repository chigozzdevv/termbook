import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keeperTransaction } from "../chain/keeper.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { SettlementModel } from "./settlement.model.js";
import { requestAuroraStatus } from "./aurora.client.js";
import type { OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";

const inboxAbi = parseAbi([
  "function vault() view returns (address)",
  "function token() view returns (address)",
  "function creditId() view returns (bytes32)",
  "function deadline() view returns (uint256)",
  "function minOut() view returns (uint256)",
  "function maxReceived() view returns (uint256)",
  "function received() view returns (uint256)",
  "function applied() view returns (uint256)",
  "function refunded() view returns (uint256)",
  "function notifyAll() returns (uint256)",
  "function notifyReceipt(uint256 amount)",
  "function settle(uint256 amount)",
  "function refund(uint256 amount)",
  "function refundUntracked(uint256 amount)",
  "function settleUntracked(uint256 amount)",
]);
const tokenAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);
const factoryAbi = parseAbi([
  "function inboxOf(bytes32 operationId) view returns (address)",
  "function recoverySettled(bytes32) view returns (bool)",
  "function settleRecoveryOperation(bytes32)",
]);
const houseAbi = parseAbi([
  "function settlementInboxes(address inbox) view returns (bool)",
  "function core() view returns (address)",
  "function depositsOpen() view returns (bool)",
  "function paused() view returns (bool)",
  "function lpInboxMinShares(address inbox) view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
]);
const coreAbi = parseAbi([
  "function creditDebt(bytes32 creditId) view returns (uint256)",
  "function solanaCollateral(bytes32) view returns (bool)",
  "function solanaRecoveryOperationConfirmed(bytes32) view returns (bool)",
  "function solanaRecoveryOperationAmount(bytes32) view returns (uint256)",
  "function solanaRecoveryRefunded(bytes32) view returns (uint256)",
  "function solanaRecoveryRetiredRefunds(bytes32) view returns (uint256)",
  "function retireRefundedSolanaRecoveryOperation(bytes32,bytes32)",
]);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const zeroBytes32 = `0x${"0".repeat(64)}`;
let running = false;

type Operation = {
  operationId: string;
  inbox: string;
  vault: string;
  token: string;
  creditId?: string;
  kind: string;
  deadline: number;
  minAmountOut: string;
  maxReceived: string;
  quote?: OneClickQuoteResponse;
  providerStatus?: string;
  providerStatusCheckedAt?: number;
  recoveryShortfall?: string;
};

async function refreshProviderStatus(operation: Operation): Promise<void> {
  if (!operation.quote) return;
  const checkedAt = Date.now();
  try {
    const status = await requestAuroraStatus(operation.quote);
    await SettlementModel.updateOne({ operationId: operation.operationId, inbox: operation.inbox }, { $set: {
      providerStatus: status.status,
      providerStatusCheckedAt: checkedAt,
      providerRefundedAmount: status.refundedAmount,
      providerOriginTxHashes: status.originTxHashes,
      providerDestinationTxHashes: status.destinationTxHashes,
    } });
  } catch (error) {
    await SettlementModel.updateOne({ operationId: operation.operationId, inbox: operation.inbox }, { $set: { providerStatusCheckedAt: checkedAt } });
    logger.warn("aurora-status-unavailable", { operationId: operation.operationId, reason: error instanceof Error ? error.message : "unknown" });
  }
}

async function trackRecoveryShortfall(
  operation: Operation, received: bigint, refunded: bigint, balance: bigint, available: bigint,
  minOut: bigint, cap: bigint, deadline: bigint,
): Promise<void> {
  if (operation.kind !== "recovery" || !["SUCCESS", "REFUNDED", "FAILED"].includes(operation.providerStatus ?? "")
    || !operation.providerStatusCheckedAt || Date.now() - operation.providerStatusCheckedAt > 300_000
    || (operation.providerStatus === "SUCCESS" && BigInt(Math.floor(Date.now() / 1000)) <= deadline + 600n)) return;
  const untracked = balance - available;
  const capacity = cap - received;
  const creditable = untracked < capacity ? untracked : capacity;
  const realized = received - refunded + creditable;
  const deficit = realized < minOut ? minOut - realized : 0n;
  if (deficit === 0n && !operation.recoveryShortfall) return;
  const shortfall = deficit.toString();
  const updated = await SettlementModel.updateOne(
    { operationId: operation.operationId, inbox: operation.inbox, recoveryShortfall: { $ne: shortfall } },
    { $set: { recoveryShortfall: shortfall, recoveryShortfallAt: Date.now() } },
  );
  if (updated.modifiedCount > 0) {
    logger.warn(deficit > 0n ? "recovery-proceeds-shortfall" : "recovery-proceeds-shortfall-resolved", {
      operationId: operation.operationId, minimum: minOut.toString(), realized: realized.toString(),
      shortfall, providerStatus: operation.providerStatus,
    });
  }
}

async function submit(
  to: `0x${string}`, operation: string, data: `0x${string}`, blockNumber: bigint,
): Promise<void> {
  const account = privateKeyToAccount(env.settlementKeeperKey as `0x${string}`);
  const chain = monadClient();
  await chain.call({ account: account.address, to, data, blockNumber });
  const result = await keeperTransaction({ client: chain, rpcUrl: env.rpcUrl,
    chainId: env.monadChainId, account, operation, to, data });
  if (result === "reverted") throw new Error("settlement-transaction-reverted");
}

async function reconcile(operation: Operation): Promise<boolean> {
  const chain = monadClient();
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  const blockNumber = finalized.number;
  const inbox = operation.inbox as `0x${string}`;
  const vault = operation.vault as `0x${string}`;
  const token = operation.token as `0x${string}`;
  const [registered, actualVault, actualToken, creditId, deadline, minOut, cap, received, applied, refunded, active, balance] = await Promise.all([
    chain.readContract({ address: env.settlementFactory as `0x${string}`, abi: factoryAbi, functionName: "inboxOf", args: [operation.operationId as `0x${string}`], blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "vault" , blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "token" , blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "creditId" , blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "deadline" , blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "minOut" , blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "maxReceived" , blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "received" , blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "applied" , blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "refunded" , blockNumber }),
    chain.readContract({ address: vault, abi: houseAbi, functionName: "settlementInboxes", args: [inbox] , blockNumber }),
    chain.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [inbox] , blockNumber }),
  ]);
  if (
    registered.toLowerCase() !== inbox.toLowerCase() || actualVault.toLowerCase() !== vault.toLowerCase()
      || actualToken.toLowerCase() !== token.toLowerCase() || !active
      || creditId.toLowerCase() !== (operation.creditId ?? zeroBytes32).toLowerCase()
      || deadline !== BigInt(operation.deadline) || minOut !== BigInt(operation.minAmountOut)
      || cap !== BigInt(operation.maxReceived) || received < applied + refunded
  ) throw new Error("settlement-inbox-mismatch");
  await SettlementModel.updateOne({ operationId: operation.operationId, inbox: operation.inbox }, {
    $set: { received: received.toString(), applied: applied.toString(), refunded: refunded.toString() },
  });
  const available = received - applied - refunded;
  if (balance < available) throw new Error("settlement-custody-shortfall");
  await trackRecoveryShortfall(operation, received, refunded, balance, available, minOut, cap, deadline);
  const now = finalized.timestamp;
  const operationKey = `${operation.operationId}:${received}:${applied}:${refunded}:${balance}`;
  const act = async (method: "notifyReceipt" | "settle" | "refund" | "refundUntracked" | "settleUntracked", amount: bigint) => {
    const data = encodeFunctionData({ abi: inboxAbi, functionName: method, args: [amount] });
    await submit(inbox, `${operationKey}:${method}`, data, blockNumber);
  };
  if (balance > available) {
    const untracked = balance - available;
    const capacity = cap - received;
    if (capacity > 0n) {
      await act("notifyReceipt", untracked < capacity ? untracked : capacity);
      return true;
    }
    if (creditId.toLowerCase() !== zeroBytes32) {
      const core = await chain.readContract({ address: vault, abi: houseAbi, functionName: "core" , blockNumber });
      const debt = await chain.readContract({ address: core, abi: coreAbi, functionName: "creditDebt", args: [creditId] , blockNumber });
      if (debt !== 0n && available === 0n) {
        await act("settleUntracked", untracked < debt ? untracked : debt);
        return true;
      }
      if (debt === 0n && now > deadline) {
        await act("refundUntracked", untracked);
        return true;
      }
    } else if (now > deadline) {
        await act("refundUntracked", untracked);
        return true;
    }
  }
  if (available === 0n) {
    if (operation.kind === "recovery" && balance === 0n) {
      const factory = env.settlementFactory as `0x${string}`;
      const operationId = operation.operationId as `0x${string}`;
      const settled = await chain.readContract({ address: factory, abi: factoryAbi,
        functionName: "recoverySettled", args: [operationId] , blockNumber });
      if (!settled && applied + refunded >= minOut) {
        await submit(factory, `${operationKey}:completed`, encodeFunctionData({ abi: factoryAbi,
          functionName: "settleRecoveryOperation", args: [operationId] }), blockNumber);
        return true;
      }
      if (!settled && now > deadline) {
        const core = await chain.readContract({ address: vault, abi: houseAbi, functionName: "core", blockNumber });
        const solana = await chain.readContract({ address: core, abi: coreAbi,
          functionName: "solanaCollateral", args: [creditId], blockNumber });
        if (solana) {
          const [confirmed, amount, sourceRefunded, retired] = await Promise.all([
            chain.readContract({ address: core, abi: coreAbi, functionName: "solanaRecoveryOperationConfirmed", args: [operationId], blockNumber }),
            chain.readContract({ address: core, abi: coreAbi, functionName: "solanaRecoveryOperationAmount", args: [operationId], blockNumber }),
            chain.readContract({ address: core, abi: coreAbi, functionName: "solanaRecoveryRefunded", args: [creditId], blockNumber }),
            chain.readContract({ address: core, abi: coreAbi, functionName: "solanaRecoveryRetiredRefunds", args: [creditId], blockNumber }),
          ]);
          if (confirmed && amount !== 0n && sourceRefunded >= retired + amount) {
            await submit(core, `${operationKey}:refunded`, encodeFunctionData({ abi: coreAbi,
              functionName: "retireRefundedSolanaRecoveryOperation", args: [creditId, operationId] }), blockNumber);
            return true;
          }
        }
      }
    }
    return false;
  }
  if (creditId.toLowerCase() === zeroBytes32) {
    if (now > deadline) {
      await act("refund", available);
      return true;
    }
    const [open, paused, minShares, totalShares, price] = await Promise.all([
      chain.readContract({ address: vault, abi: houseAbi, functionName: "depositsOpen" , blockNumber }),
      chain.readContract({ address: vault, abi: houseAbi, functionName: "paused" , blockNumber }),
      chain.readContract({ address: vault, abi: houseAbi, functionName: "lpInboxMinShares", args: [inbox] , blockNumber }),
      chain.readContract({ address: vault, abi: houseAbi, functionName: "totalShares" , blockNumber }),
      chain.readContract({ address: vault, abi: houseAbi, functionName: "sharePrice" , blockNumber }),
    ]);
    const minted = totalShares === 0n ? available : price === 0n ? 0n : available * 1_000_000_000_000_000_000n / price;
    if (!open || paused || minShares === 0n || minted < minShares || available < minOut) return false;
    await act("settle", available);
    return true;
  }
  const core = await chain.readContract({ address: vault, abi: houseAbi, functionName: "core" , blockNumber });
  if (core.toLowerCase() === zeroAddress) throw new Error("settlement-core-missing");
  const debt = await chain.readContract({ address: core, abi: coreAbi, functionName: "creditDebt", args: [creditId] , blockNumber });
  if (debt > 0n) {
    await act("settle", available < debt ? available : debt);
    return true;
  }
  if (now > deadline) {
    await act("refund", available);
    return true;
  }
  return false;
}

export async function runSettlementWorker(): Promise<number> {
  if (!env.settlementKeeperKey || !env.settlementFactory || running) return 0;
  running = true;
  let completed = 0;
  try {
    if (await monadClient().getChainId() !== env.monadChainId) throw new Error("settlement-chain-mismatch");
    const operations = await SettlementModel.find({ inbox: { $exists: true } }).sort({ settlementCheckedAt: 1, operationId: 1 }).limit(25).lean();
    for (const operation of operations) {
      try {
        if (await reconcile(operation as Operation)) completed++;
      } catch (error) {
        logger.warn("settlement-reconciliation-failed", { operationId: operation.operationId, reason: error instanceof Error ? error.message : "unknown" });
      } finally {
        await SettlementModel.updateOne({ operationId: operation.operationId },
          { $set: { settlementCheckedAt: new Date() } });
      }
    }
    await Promise.all(operations
      .filter((operation) => operation.quote && (!operation.providerStatusCheckedAt || operation.providerStatusCheckedAt < Date.now() - 60_000))
      .slice(0, 5)
      .map((operation) => refreshProviderStatus(operation as Operation)));
  } finally {
    running = false;
  }
  return completed;
}
