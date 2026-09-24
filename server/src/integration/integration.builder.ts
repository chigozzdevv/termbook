import {
  decodeFunctionData, keccak256, parseAbi, parseAbiItem, padHex, stringToHex, toFunctionSelector,
  type Address, type Hex,
} from "viem";
import type { CapabilityDefinition } from "@termbook/schema";
import { termbookCoreAbi } from "@termbook/bindings";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import type { integrationAcceptanceSchema } from "./integration.schema.js";
import { coreActionAbi } from "./integration.abi.js";
import type { z } from "zod";

type Acceptance = z.infer<typeof integrationAcceptanceSchema>;

const healthAbi = parseAbi([
  "function readers(bytes32) view returns (address,uint256,bool,uint256,bytes32)",
]);
const coreBindingAbi = parseAbi([
  "function healthSource() view returns (address)",
  "function appRecoveryAdapterOfBundle(bytes32) view returns (address)",
]);
const appHealthAbi = parseAbi(["function appReader() view returns (address)"]);
const appReaderAbi = parseAbi([
  "function positionCount(bytes32,address) view returns (uint256)",
  "function pendingCount(bytes32,address) view returns (uint256)",
  "function readAppValue(bytes32,address,address) view returns (int256,uint16,uint128,uint256)",
]);
const vaultAbi = parseAbi(["function asset() view returns (address)"]);
const recoveryTopic = keccak256(stringToHex("AppRecoveryStep(bytes32,address,address,bytes32)"));
const zero = "0x0000000000000000000000000000000000000000";

function equal(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export async function validateIntegrationAcceptance(
  versionId: Hex,
  settlementAsset: Address,
  actions: CapabilityDefinition[],
  acceptance: Acceptance,
): Promise<void> {
  const actionNames = actions.map((action) => action.capability);
  if (Object.keys(acceptance.actionTransactions).length !== actions.length
    || actionNames.some((name) => !acceptance.actionTransactions[name])) {
    throw new Error("integration-action-evidence-incomplete");
  }
  const actionHashes = Object.values(acceptance.actionTransactions).map((item) => item.txHash.toLowerCase());
  if (new Set(actionHashes).size !== actionHashes.length
    || new Set(acceptance.recoveryTxHashes.map((hash) => hash.toLowerCase())).size !== acceptance.recoveryTxHashes.length
    || !Object.values(acceptance.actionTransactions).some((item) =>
      equal(item.creditId, acceptance.recoveredCreditId))) {
    throw new Error("integration-action-evidence-incomplete");
  }
  const chain = monadClient();
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (await chain.getChainId() !== env.monadChainId) throw new Error("integration-chain-mismatch");
  const core = env.core as Address;
  const [health, adapter, activeCredit, recoveredCredit] = await Promise.all([
    chain.readContract({ address: core, abi: coreBindingAbi, functionName: "healthSource", blockNumber: finalized.number }),
    chain.readContract({ address: core, abi: coreBindingAbi, functionName: "appRecoveryAdapterOfBundle",
      args: [versionId], blockNumber: finalized.number }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails",
      args: [acceptance.activeCreditId as Hex], blockNumber: finalized.number }),
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails",
      args: [acceptance.recoveredCreditId as Hex], blockNumber: finalized.number }),
  ]);
  if (equal(health, zero) || equal(adapter, zero) || equal(activeCredit.account, zero)
    || equal(recoveredCredit.account, zero) || equal(activeCredit.account, recoveredCredit.account)
    || !equal(activeCredit.bundleId, versionId) || !equal(recoveredCredit.bundleId, versionId)) {
    throw new Error("integration-credit-evidence-invalid");
  }
  const [readerConfig, asset, recoveredAsset, activeAccountCode, recoveredAccountCode] = await Promise.all([
    chain.readContract({ address: health, abi: healthAbi, functionName: "readers",
      args: [versionId], blockNumber: finalized.number }),
    chain.readContract({ address: activeCredit.vault, abi: vaultAbi, functionName: "asset",
      blockNumber: finalized.number }),
    chain.readContract({ address: recoveredCredit.vault, abi: vaultAbi, functionName: "asset",
      blockNumber: finalized.number }),
    chain.getBytecode({ address: activeCredit.account, blockNumber: finalized.number }),
    chain.getBytecode({ address: recoveredCredit.account, blockNumber: finalized.number }),
  ]);
  if (!equal(asset, settlementAsset) || !equal(recoveredAsset, settlementAsset)
    || !activeAccountCode || activeAccountCode === "0x" || !recoveredAccountCode || recoveredAccountCode === "0x"
    || equal(readerConfig[0], zero) || !readerConfig[2] || readerConfig[3] === 0n) {
    throw new Error("integration-reader-evidence-invalid");
  }
  const appReader = await chain.readContract({ address: readerConfig[0], abi: appHealthAbi,
    functionName: "appReader", blockNumber: finalized.number });
  if (equal(appReader, zero)) throw new Error("integration-reader-evidence-invalid");
  const [positions, pending, value, recoveredPositions, recoveredPending] = await Promise.all([
    chain.readContract({ address: appReader, abi: appReaderAbi, functionName: "positionCount",
      args: [acceptance.activeCreditId as Hex, activeCredit.account], blockNumber: finalized.number }),
    chain.readContract({ address: appReader, abi: appReaderAbi, functionName: "pendingCount",
      args: [acceptance.activeCreditId as Hex, activeCredit.account], blockNumber: finalized.number }),
    chain.readContract({ address: appReader, abi: appReaderAbi, functionName: "readAppValue",
      args: [acceptance.activeCreditId as Hex, activeCredit.account, settlementAsset], blockNumber: finalized.number }),
    chain.readContract({ address: appReader, abi: appReaderAbi, functionName: "positionCount",
      args: [acceptance.recoveredCreditId as Hex, recoveredCredit.account], blockNumber: finalized.number }),
    chain.readContract({ address: appReader, abi: appReaderAbi, functionName: "pendingCount",
      args: [acceptance.recoveredCreditId as Hex, recoveredCredit.account], blockNumber: finalized.number }),
  ]);
  if (positions > 32n || pending > 32n || value[0] <= 0n
    || value[1] > 10_000 || value[3] === 0n || value[3] > finalized.timestamp
    || finalized.timestamp - value[3] > readerConfig[3]
    || recoveredPositions !== 0n || recoveredPending !== 0n) {
    throw new Error("integration-position-evidence-invalid");
  }
  const canonicalReceipt = async (hash: Hex) => {
    const receipt = await chain.getTransactionReceipt({ hash });
    if (receipt.status !== "success" || receipt.blockNumber > finalized.number || !equal(receipt.transactionHash, hash)) {
      throw new Error("integration-transaction-evidence-invalid");
    }
    const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
    if (!equal(block.hash, receipt.blockHash)) throw new Error("integration-transaction-evidence-invalid");
    return receipt;
  };
  let recoverySetupBlock = 0n;
  for (const action of actions) {
    const evidence = acceptance.actionTransactions[action.capability]!;
    const hash = evidence.txHash as Hex;
    const [receipt, transaction, actionCredit] = await Promise.all([
      canonicalReceipt(hash), chain.getTransaction({ hash }),
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails",
        args: [evidence.creditId as Hex], blockNumber: finalized.number }),
    ]);
    if (!equal(receipt.to ?? zero, core) || !equal(transaction.to ?? zero, core)
      || !equal(transaction.hash, hash) || !equal(transaction.blockHash ?? "", receipt.blockHash)) {
      throw new Error("integration-action-evidence-invalid");
    }
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: coreActionAbi, data: transaction.input });
    } catch {
      throw new Error("integration-action-evidence-invalid");
    }
    const [creditId, target, data] = decoded.args;
    const item = parseAbiItem(action.signature);
    if (item.type !== "function" || !equal(creditId, evidence.creditId)
      || !equal(actionCredit.bundleId, versionId)
      || !equal(target, action.target) || !equal(data.slice(0, 10), toFunctionSelector(item))) {
      throw new Error("integration-action-evidence-invalid");
    }
    if (equal(creditId, acceptance.recoveredCreditId) && receipt.blockNumber > recoverySetupBlock) {
      recoverySetupBlock = receipt.blockNumber;
    }
  }
  const recoveryCreditTopic = acceptance.recoveredCreditId.toLowerCase();
  const adapterTopic = padHex(adapter, { size: 32 }).toLowerCase();
  for (const hash of acceptance.recoveryTxHashes) {
    const receipt = await canonicalReceipt(hash as Hex);
    if (!equal(receipt.to ?? zero, core) || receipt.blockNumber <= recoverySetupBlock
      || !receipt.logs.some((log) =>
      equal(log.address, core) && log.topics.length === 4
        && equal(log.topics[0] ?? "", recoveryTopic)
        && equal(log.topics[1] ?? "", recoveryCreditTopic)
        && equal(log.topics[2] ?? "", adapterTopic))) {
      throw new Error("integration-recovery-evidence-invalid");
    }
  }
}
