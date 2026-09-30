import { capabilityCalls, type CapabilityDefinition } from "@termbook/schema";
import { keccak256, padHex, parseAbi, stringToHex, toHex } from "viem";
import { buildAction, buildCapabilityCall, type ActionContext } from "./action.js";
import type { AppAction } from "../types/app.types.js";

export type ExecutionCall = { target: `0x${string}`; spendToken: `0x${string}`; spendAmount: bigint; data: `0x${string}` };
export type ExecutionAction = { capability: `0x${string}`; market: `0x${string}`; calls: ExecutionCall[];
  requiredInput: bigint; exposureLimit: bigint };
export type ExecutionAuthorization = { drawAmount: bigint; maxDraw: bigint; nonce: bigint; deadline: bigint;
  revision: bigint; signer: `0x${string}`; signature: `0x${string}`; price: ExecutionPrice };
export type ExecutionPrice = { roundId: bigint; referencePrice: bigint; updatedAt: bigint; authorizedAt: bigint; bound: bigint; slippageBps: number; isMax: boolean };
export const emptyExecutionPrice: ExecutionPrice = { roundId: 0n, referencePrice: 0n, updatedAt: 0n, authorizedAt: 0n, bound: 0n, slippageBps: 0, isMax: false };
export const priceTuple = "(uint80 roundId,uint256 referencePrice,uint256 updatedAt,uint256 authorizedAt,uint256 bound,uint16 slippageBps,bool isMax)";
export const executionCoreAbi = parseAbi([
  "struct ExecutionCall { address target; address spendToken; uint256 spendAmount; bytes data; }",
  "struct ExecutionAction { bytes32 capability; bytes32 market; ExecutionCall[] calls; uint256 requiredInput; uint256 exposureLimit; }",
  "struct ExecutionPrice { uint80 roundId; uint256 referencePrice; uint256 updatedAt; uint256 authorizedAt; uint256 bound; uint16 slippageBps; bool isMax; }",
  "struct ExecutionAuthorization { uint256 drawAmount; uint256 maxDraw; uint256 nonce; uint256 deadline; uint256 revision; address signer; bytes signature; ExecutionPrice price; }",
  "function managedBundle(bytes32) view returns (bool)",
  "function executionManager() view returns (address)",
  "function previewPlan(bytes32,ExecutionAction,uint256,uint256,ExecutionPrice)",
  "function executionDigest(bytes32,ExecutionAction,ExecutionAuthorization) view returns (bytes32)",
  "function executePlan(bytes32,ExecutionAction,ExecutionAuthorization) returns (bytes[])",
  "error ActionPreview(uint256 healthBps,uint256 initialBps,uint256 debt,uint256 recoveryValue)",
]);
const pendingState = "(bytes32 positionId,uint256 committed,uint256 filled,uint256 refunded,uint256 remaining,uint256 liability,uint256 maxLiability,uint256 deadline,uint256 observedAt,uint8 positionSlots,address refundRecipient,uint8 status)";
export const executionManagerAbi = parseAbi([
  "event ActionPending(bytes32 indexed creditId,bytes32 indexed pendingId,bytes32 capability,bytes32 market)",
  "function bundles(bytes32) view returns (address policy,address reader,bytes32 policyCodeHash,bytes32 readerCodeHash,bytes32 policyHash,uint8 maxPositions,uint8 maxPending,uint32 maxAge)",
  "function pendingCount(bytes32) view returns (uint256)",
  "function pendingAt(bytes32,uint256) view returns (bytes32)",
  `function records(bytes32,bytes32) view returns (bytes32 capability,bytes32 market,uint256 exposureLimit,uint8 reservedSlots,${pendingState} state)`,
]);
export const executionPolicyAbi = parseAbi([`function pendingState(bytes32,address,bytes32) view returns (${pendingState})`]);
const zeroAddress = `0x${"0".repeat(40)}` as const;

function at(params: Record<string, unknown>, path: string): unknown {
  let value: unknown = params;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error("action-input-required");
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
function amount(value: unknown): bigint {
  if (typeof value !== "bigint" && typeof value !== "string" && typeof value !== "number"
    || typeof value === "number" && !Number.isSafeInteger(value) || !/^\d+$/.test(String(value))) {
    throw new Error("action-input-invalid");
  }
  const result = BigInt(String(value));
  if (result >= 2n ** 256n) throw new Error("action-input-invalid");
  return result;
}
export function executionMarket(value: unknown): `0x${string}` {
  if (typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value)) return value as `0x${string}`;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string" && /^\d+$/.test(value)) {
    return padHex(toHex(amount(value)), { size: 32 });
  }
  if (typeof value !== "string" || !value || value.length > 128) throw new Error("action-input-invalid");
  return keccak256(stringToHex(value));
}
export function buildExecution(definition: CapabilityDefinition, action: AppAction,
  context: ActionContext,
  settlementAsset: `0x${string}`): ExecutionAction {
  const { requiredInput } = buildAction(definition, action, context);
  if (capabilityCalls(definition).length > 8) throw new Error("action-definition-invalid");
  return { capability: keccak256(stringToHex(definition.capability)),
    market: definition.marketPath ? executionMarket(at(action.params, definition.marketPath)) : padHex("0x", { size: 32 }),
    requiredInput,
    exposureLimit: definition.exposurePath ? amount(at(action.params, definition.exposurePath)) : requiredInput,
    calls: capabilityCalls(definition).map((call) => {
      const spendAmount = call.fundingPath ? amount(at(action.params, call.fundingPath)) : 0n;
      return { ...buildCapabilityCall(call, action, context), spendAmount,
        spendToken: (spendAmount === 0n ? zeroAddress : call.spendToken ?? settlementAsset) as `0x${string}` };
    }) };
}
