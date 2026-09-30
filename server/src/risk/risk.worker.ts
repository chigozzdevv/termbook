import { encodeFunctionData, parseAbi, type Hex, type PublicClient } from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
import { monadClient } from "../chain/monad.client.js";
import { keeperTransaction } from "../chain/keeper.js";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { riskKeeper } from "./risk.config.js";
import { riskRepo } from "./risk.repo.js";
import { recoveryClearancePlan } from "../recovery/clearance.service.js";

const healthAbi = parseAbi([
  "function previewHealth(bytes32) view returns ((uint256 debt,uint256 cash,uint256 sourceValue,int256 appValue,uint16 retainedSource,uint16 retainedApp,uint128 recoveryCosts,uint256 recoveryValue,uint256 healthBps))",
]);
const riskAbi = parseAbi([
  "function liquidationBps(bytes32) view returns (uint256)",
  "function freezeBps(bytes32) view returns (uint256)",
  "function watchBps(bytes32) view returns (uint256)",
]);
const exitAbi = parseAbi(["function canExit(bytes32,address) view returns (bool)"]);
const plannerAbi = parseAbi(["function nextExitStep(bytes32,address) view returns (bytes32,bytes,uint256)"]);
const houseAbi = parseAbi(["function asset() view returns (address)"]);
const remoteAbi = parseAbi([
  "function remoteSeizureConfirmed(bytes32) view returns (bool)",
  "function remoteRecoveryCleared(bytes32) view returns (bool)",
  "function ethereumWormholeCore() view returns (address)",
  "function solanaWormholeCore() view returns (address)",
  "function pendingRecoveryCount(bytes32) view returns (uint256)",
  "function inboxFactory() view returns (address)",
  "function messageFee() view returns (uint256)",
]);
let running = false;

export async function runRiskWorker(): Promise<number> {
  if (running) return 0;
  running = true;
  const key = `${env.monadChainId}:${env.core.toLowerCase()}`;
  try {
    const chain = monadClient();
    if (await chain.getChainId() !== env.monadChainId) throw new Error("risk-chain-mismatch");
    const finalized = await chain.getBlock({ blockTag: "finalized" });
    const keeper = riskKeeper();
    if (keeper && !await chain.readContract({ address: env.core as Hex, abi: termbookCoreAbi,
      functionName: "recoveryKeepers", args: [keeper.address], blockNumber: finalized.number })) {
      throw new Error("risk-keeper-not-approved");
    }
    const credits = await riskRepo.page(key);
    for (let offset = 0; offset < credits.length; offset += 8) {
      await Promise.all(credits.slice(offset, offset + 8).map(async (id) => {
        try { await inspectCredit(chain, id as Hex, finalized, keeper); }
        catch (error) {
          const failure = error instanceof Error && /^risk-[a-z-]+$/.test(error.message)
            ? error.message : "risk-state-unavailable";
          await riskRepo.record(`${key}:${id.toLowerCase()}`, { state: "unavailable", failure,
            block: finalized.number.toString(), blockHash: finalized.hash });
          logger.warn("risk-check-failed", { creditId: id, failure });
        }
      }));
    }
    await riskRepo.advance(key, credits.at(-1) ?? "");
    return credits.length;
  } finally { running = false; }
}

async function inspectCredit(chain: PublicClient, id: Hex,
  finalized: { number: bigint; hash: Hex; timestamp: bigint }, keeper: ReturnType<typeof riskKeeper>): Promise<void> {
  const core = env.core as Hex;
  const blockNumber = finalized.number;
  const c = await chain.readContract({ address: core, abi: termbookCoreAbi,
    functionName: "creditDetails", args: [id], blockNumber });
  const key = `${env.monadChainId}:${core.toLowerCase()}:${id.toLowerCase()}`;
  const send = async (name: "markMatured" | "markDefaulted" | "startLiquidation" | "repayAvailableCash" | "cure",
    args: readonly [Hex]): Promise<void> => {
    if (!keeper) return;
    await chain.simulateContract({ address: core, abi: termbookCoreAbi, functionName: name,
      args, account: keeper.address, blockNumber });
    const result = await keeperTransaction({ client: chain, rpcUrl: env.rpcUrl,
      chainId: env.monadChainId, account: keeper, operation: `${id}:${c.revision}:${name}`,
      to: core, data: encodeFunctionData({ abi: termbookCoreAbi, functionName: name, args }) });
    if (result === "reverted") throw new Error("risk-operation-reverted");
  };
  const record = async (state: string, extra: Record<string, unknown> = {}) => {
    await riskRepo.record(key, { state, debt: c.debt.toString(), healthBps: "",
      failure: "", block: blockNumber.toString(), blockHash: finalized.hash, ...extra });
  };
  if (![4, 5, 8, 9].includes(c.facility)) { await record("inactive"); return; }
  if (c.debt !== 0n && finalized.timestamp > c.maturity + c.grace && c.payment !== 3) {
    await record("default_due"); await send("markDefaulted", [id]); return;
  }
  if (finalized.timestamp >= c.maturity && c.payment === 1) {
    await record("matured"); await send("markMatured", [id]); return;
  }
  if ([8, 9].includes(c.facility)) {
    await record("recovering");
    if (c.debt !== 0n) {
      const cash = await chain.readContract({ address: core, abi: termbookCoreAbi,
        functionName: "creditFreeCash", args: [id], blockNumber });
      if (cash !== 0n) { await send("repayAvailableCash", [id]); return; }
    }
    const full = await chain.readContract({ address: core, abi: termbookCoreAbi,
      functionName: "fullTermination", args: [id], blockNumber });
    if (!full) {
      if (keeper) {
        try { await send("cure", [id]); return; }
        catch { await record("recovery_pending"); }
      }
    }
    const verifier = await chain.readContract({ address: core, abi: termbookCoreAbi,
      functionName: "exitVerifierOfBundle", args: [c.bundleId], blockNumber });
    const exited = await chain.readContract({ address: verifier, abi: exitAbi,
      functionName: "canExit", args: [id, c.account], blockNumber });
    if (!exited) {
      const planner = await chain.readContract({ address: core, abi: termbookCoreAbi,
        functionName: "exitPlannerOfBundle", args: [c.bundleId], blockNumber });
      const [operation, instruction, retryAt] = await chain.readContract({ address: planner, abi: plannerAbi,
        functionName: "nextExitStep", args: [id, c.account], blockNumber });
      if (retryAt > finalized.timestamp) { await record("application_settlement_pending"); return; }
      if (operation === `0x${"0".repeat(64)}` || instruction.length <= 2 || instruction.length > 8194) {
        throw new Error("risk-exit-plan-invalid");
      }
      if (keeper) {
        const data = encodeFunctionData({ abi: termbookCoreAbi, functionName: "recoverApp", args: [id, instruction] });
        await chain.call({ account: keeper.address, to: core, data, blockNumber });
        await keeperTransaction({ client: chain, rpcUrl: env.rpcUrl, chainId: env.monadChainId,
          account: keeper, operation: `${id}:${c.revision}:${operation}`, to: core, data });
      }
      return;
    }
    if (!full) { await record("partial_collateral_recovery_required"); return; }
    const remote = await chain.readContract({ address: core, abi: termbookCoreAbi,
      functionName: "remoteCollateral", args: [id], blockNumber });
    if (remote) {
      const pending = await chain.readContract({ address: core, abi: termbookCoreAbi,
        functionName: "pendingRemoteSeizure", args: [id], blockNumber });
      if (pending !== 0n) { await record("source_seizure_pending"); return; }
      const solana = await chain.readContract({ address: core, abi: termbookCoreAbi,
        functionName: "solanaCollateral", args: [id], blockNumber });
      if (c.debt !== 0n && c.collateralAmount !== 0n) {
        await record("source_seizure_required");
        if (keeper) {
          const wormhole = await chain.readContract({ address: core, abi: remoteAbi,
            functionName: solana ? "solanaWormholeCore" : "ethereumWormholeCore", blockNumber });
          const value = await chain.readContract({ address: wormhole, abi: remoteAbi,
            functionName: "messageFee", blockNumber });
          const data = encodeFunctionData({ abi: termbookCoreAbi, functionName: "authorizeRemoteSeizure",
            args: [id, c.collateralAmount, finalized.timestamp + 86400n] });
          await chain.call({ account: keeper.address, to: core, data, value, blockNumber });
          await keeperTransaction({ client: chain, rpcUrl: env.rpcUrl, chainId: env.monadChainId,
            account: keeper, operation: `${id}:${c.revision}:seize`, to: core, data, value });
        }
        return;
      }
      const seized = await chain.readContract({ address: core, abi: remoteAbi,
        functionName: "remoteSeizureConfirmed", args: [id], blockNumber });
      if (seized) {
        const factory = await chain.readContract({ address: c.vault, abi: remoteAbi,
          functionName: "inboxFactory", blockNumber });
        const outstanding = await chain.readContract({ address: factory, abi: remoteAbi,
          functionName: "pendingRecoveryCount", args: [id], blockNumber });
        if (outstanding !== 0n) { await record("recovery_delivery_pending"); return; }
        const cleared = await chain.readContract({ address: core, abi: remoteAbi,
          functionName: "remoteRecoveryCleared", args: [id], blockNumber });
        if (!cleared) {
          await record(solana ? "solana_clearance_proof_required" : "source_clearance_pending");
          if (keeper && !solana) {
            const plan = await recoveryClearancePlan({ creditId: id }, keeper.address);
            await keeperTransaction({ client: chain, rpcUrl: env.rpcUrl, chainId: env.monadChainId,
              account: keeper, operation: `${id}:${c.revision}:clearance`, to: plan.to, data: plan.data });
          }
          return;
        }
      }
      await record(c.collateralAmount !== 0n ? "borrower_collateral_return_available" : "house_finalization_required");
      return;
    }
    if (c.debt !== 0n && c.collateralAmount !== 0n) {
      const asset = await chain.readContract({ address: c.vault, abi: houseAbi, functionName: "asset", blockNumber });
      if (asset.toLowerCase() !== c.collateralAsset.toLowerCase()) {
        await record("collateral_bid_required"); return;
      }
      const amount = c.debt < c.collateralAmount ? c.debt : c.collateralAmount;
      if (keeper) {
        const data = encodeFunctionData({ abi: termbookCoreAbi, functionName: "recoverCollateral", args: [id, amount] });
        await chain.call({ account: keeper.address, to: core, data, blockNumber });
        await keeperTransaction({ client: chain, rpcUrl: env.rpcUrl, chainId: env.monadChainId,
          account: keeper, operation: `${id}:${c.revision}:collateral`, to: core, data });
      }
      return;
    }
    await record("house_finalization_required"); return;
  }
  if (c.debt === 0n) { await record("healthy"); return; }
  if (c.payment === 3) { await record("defaulted"); await send("startLiquidation", [id]); return; }
  const risk = await chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "riskEngine", blockNumber });
  const [snapshot, liquidation, freeze, watch, debt] = await Promise.all([
    chain.readContract({ address: core, abi: healthAbi, functionName: "previewHealth", args: [id], blockNumber }),
    chain.readContract({ address: risk, abi: riskAbi, functionName: "liquidationBps", args: [id], blockNumber }),
    chain.readContract({ address: risk, abi: riskAbi, functionName: "freezeBps", args: [id], blockNumber }),
    chain.readContract({ address: risk, abi: riskAbi, functionName: "watchBps", args: [id], blockNumber }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDebt", args: [id], blockNumber }),
  ]);
  if (liquidation === 0n || freeze < liquidation || watch < freeze || snapshot.debt !== debt) throw new Error("risk-reading-invalid");
  const state = snapshot.healthBps <= liquidation ? "liquidatable"
    : snapshot.healthBps <= freeze ? "frozen" : snapshot.healthBps <= watch ? "watch" : "healthy";
  await record(state, { debt: debt.toString(), healthBps: snapshot.healthBps.toString() });
  if (state === "liquidatable") await send("startLiquidation", [id]);
}
