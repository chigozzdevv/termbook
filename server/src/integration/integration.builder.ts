import {
  decodeAbiParameters, decodeFunctionData, keccak256, parseAbi, parseAbiItem, padHex, stringToHex, toFunctionSelector,
  type Address, type Hex,
} from "viem";
import { capabilityCalls, capabilityDependencies, executionKey, type CapabilityDefinition } from "@termbook/schema";
import { termbookCoreAbi } from "@termbook/bindings";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import type { integrationAcceptanceSchema } from "./integration.schema.js";
import { decodeCoreAction } from "./integration.abi.js";
import { validateIntegrationSuite } from "./integration.suite.js";
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
const repaidTopic = keccak256(stringToHex("Repaid(bytes32,uint256,uint256)"));
const recoverCashAbi = parseAbi(["function recoverAccountCash(bytes32 creditId,uint256 amount)",
  "function repayAvailableCash(bytes32 creditId)"]);
const zero = "0x0000000000000000000000000000000000000000";

function equal(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export async function validateIntegrationAcceptance(
  versionId: Hex,
  settlementAsset: Address,
  actions: CapabilityDefinition[],
  acceptance: Acceptance,
  manifestHash: Hex,
): Promise<void> {
  const chain = monadClient();
  const suite = await validateIntegrationSuite(chain, versionId, manifestHash, acceptance.suite, acceptance.evidenceHash, actions);
  const actionNames = actions.map(executionKey);
  if (Object.keys(acceptance.actionTransactions).length !== actions.length
    || actionNames.some((name) => !acceptance.actionTransactions[name])) {
    throw new Error("integration-action-evidence-incomplete");
  }
  const actionHashes = Object.values(acceptance.actionTransactions).map((item) => item.txHash.toLowerCase());
  const recoveryHashes = acceptance.recoveryTxHashes.map((hash) => hash.toLowerCase());
  if (new Set(actionHashes).size !== actionHashes.length
    || new Set(recoveryHashes).size !== recoveryHashes.length
    || actionHashes.includes(acceptance.repaymentTxHash.toLowerCase())
    || recoveryHashes.includes(acceptance.repaymentTxHash.toLowerCase())
    || !Object.values(acceptance.actionTransactions).some((item) =>
      equal(item.creditId, acceptance.recoveredCreditId))) {
    throw new Error("integration-action-evidence-incomplete");
  }
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
    || !equal(activeCredit.bundleId, versionId) || !equal(recoveredCredit.bundleId, versionId)
    || !equal(activeCredit.borrower, suite.actors.borrower) || !equal(recoveredCredit.borrower, suite.actors.borrower)) {
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
  const pins = new Set(suite.contracts.filter((pin) => !pin.fixture).map((pin) => pin.target.toLowerCase()));
  if ([core, health, adapter, readerConfig[0], appReader, activeCredit.account, recoveredCredit.account,
    activeCredit.vault, recoveredCredit.vault, settlementAsset, ...actions.flatMap(capabilityDependencies).map((call) => call.target)]
    .some((target) => !pins.has(target.toLowerCase()))) throw new Error("integration-suite-pin-missing");
  if (suite.exclusions.some((item) => item.id === "retention_authorization")
    && await chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "retentionSupported", args: [versionId], blockNumber: finalized.number })) {
    throw new Error("integration-suite-exclusion-invalid");
  }
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
    const evidence = acceptance.actionTransactions[executionKey(action)]!;
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
      decoded = decodeCoreAction(transaction.input);
    } catch {
      throw new Error("integration-action-evidence-invalid");
    }
    const { creditId, calls } = decoded;
    const expected = capabilityCalls(action);
    if (!equal(creditId, evidence.creditId) || !equal(actionCredit.bundleId, versionId)
      || calls.length !== expected.length
      || action.executionKey && !decoded.capability
      || decoded.capability && !equal(decoded.capability, keccak256(stringToHex(executionKey(action))))
      || calls.some((call, index) => {
        const item = parseAbiItem(expected[index]!.signature);
        return item.type !== "function" || (expected[index]!.nativeValue !== undefined ? call.nativeValue !== BigInt(expected[index]!.nativeValue!)
          : expected[index]!.valuePath || expected[index]!.valueFromBound ? call.nativeValue <= 0n : call.nativeValue !== 0n)
          || !equal(call.target, expected[index]!.target)
          || !equal(call.data.slice(0, 10), toFunctionSelector(item));
      })) {
      throw new Error("integration-action-evidence-invalid");
    }
    if (equal(creditId, acceptance.recoveredCreditId) && receipt.blockNumber > recoverySetupBlock) {
      recoverySetupBlock = receipt.blockNumber;
    }
  }
  const recoveryCreditTopic = acceptance.recoveredCreditId.toLowerCase();
  const adapterTopic = padHex(adapter, { size: 32 }).toLowerCase();
  let latestRecoveryBlock = 0n;
  let latestRecoveryIndex = 0;
  for (const hash of acceptance.recoveryTxHashes) {
    const receipt = await canonicalReceipt(hash as Hex);
    const transaction = await chain.getTransaction({ hash: hash as Hex });
    const approved = await chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "recoveryKeepers",
      args: [suite.actors.keeper as Address], blockNumber: receipt.blockNumber });
    if (!approved || !equal(transaction.from, suite.actors.keeper) || equal(transaction.from, recoveredCredit.borrower)
      || !equal(transaction.to ?? zero, core) || !equal(transaction.blockHash ?? "", receipt.blockHash)
      || !equal(receipt.to ?? zero, core) || receipt.blockNumber <= recoverySetupBlock
      || !receipt.logs.some((log) =>
      equal(log.address, core) && log.topics.length === 4
        && equal(log.topics[0] ?? "", recoveryTopic)
        && equal(log.topics[1] ?? "", recoveryCreditTopic)
        && equal(log.topics[2] ?? "", adapterTopic))) {
      throw new Error("integration-recovery-evidence-invalid");
    }
    if (receipt.blockNumber > latestRecoveryBlock
      || receipt.blockNumber === latestRecoveryBlock && receipt.transactionIndex > latestRecoveryIndex) {
      latestRecoveryBlock = receipt.blockNumber;
      latestRecoveryIndex = receipt.transactionIndex;
    }
  }
  const repaymentHash = acceptance.repaymentTxHash as Hex;
  const [repayment, repaymentTx] = await Promise.all([
    canonicalReceipt(repaymentHash), chain.getTransaction({ hash: repaymentHash }),
  ]);
  if (!equal(repayment.to ?? zero, core) || !equal(repaymentTx.to ?? zero, core)
    || !equal(repaymentTx.from, suite.actors.keeper) || equal(repaymentTx.from, recoveredCredit.borrower)
    || !equal(repaymentTx.hash, repaymentHash)
    || !equal(repaymentTx.blockHash ?? "", repayment.blockHash)
    || repayment.blockNumber < latestRecoveryBlock
    || repayment.blockNumber === latestRecoveryBlock && repayment.transactionIndex <= latestRecoveryIndex) {
    throw new Error("integration-repayment-evidence-invalid");
  }
  let repaymentAmount: bigint | undefined;
  try {
    const decoded = decodeFunctionData({ abi: recoverCashAbi, data: repaymentTx.input });
    if (!equal(decoded.args[0], acceptance.recoveredCreditId)) throw new Error();
    if (decoded.functionName === "recoverAccountCash") {
      if (decoded.args[1] === 0n) throw new Error();
      repaymentAmount = decoded.args[1];
    }
  } catch {
    throw new Error("integration-repayment-evidence-invalid");
  }
  const matches = repayment.logs.filter((log) => {
    if (!equal(log.address, core) || log.topics.length !== 2
      || !equal(log.topics[0] ?? "", repaidTopic)
      || !equal(log.topics[1] ?? "", recoveryCreditTopic)) return false;
    try {
      const [amount] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], log.data);
      return amount > 0n && (repaymentAmount === undefined || amount === repaymentAmount);
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) throw new Error("integration-repayment-evidence-invalid");
}
