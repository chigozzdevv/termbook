import type { CapabilityDefinition } from "@termbook/schema";
import { keccak256, parseAbi, stringToHex } from "viem";
import type { TermbookClient } from "../client/client.js";
import type { AppAction } from "../types/app.types.js";
import { executionMarket, type ExecutionPrice } from "./execution.js";

const coreAbi = parseAbi(["function priceProtection() view returns (address)"]);
const protectionAbi = parseAbi([
  "function rule(bytes32,bytes32,bytes32) view returns ((address oracle,bytes32 feedId,address target,bytes4 selector,uint8 callIndex,uint8 priceDecimals,uint16 priceWord,uint16 directionWord,uint16 maxSlippageBps,uint16 maxDeviationBps,uint32 maxAuthorizationAge,uint256 maximumDirection,uint256 minimumDirection))",
  "function houseSlippage(bytes32) view returns (uint16)",
]);
const oracleAbi = parseAbi(["function read(bytes32) view returns (uint256 value,uint256 updatedAt,uint80 roundId)"]);
function input(params: Record<string, unknown>, path: string): unknown {
  let value: unknown = params;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, key)) throw new Error("action-input-required");
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
export function deriveExecutionBound(referencePrice: bigint, bps: number, isMax: boolean, decimals: number): bigint {
  if (referencePrice <= 0n || !Number.isInteger(bps) || bps < 0 || bps > 5000
    || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("action-price-invalid");
  let numerator = referencePrice * BigInt(isMax ? 10000 + bps : 10000 - bps);
  let denominator = 10000n;
  if (decimals < 18) denominator *= 10n ** BigInt(18 - decimals);
  else numerator *= 10n ** BigInt(decimals - 18);
  const bound = isMax ? numerator / denominator : (numerator - 1n) / denominator + 1n;
  if (bound <= 0n || bound >= 2n ** 256n) throw new Error("action-price-invalid");
  return bound;
}
export async function executionPrice(client: TermbookClient, creditId: `0x${string}`, bundle: `0x${string}`,
  definition: CapabilityDefinition, action: AppAction, previous?: ExecutionPrice): Promise<ExecutionPrice | undefined> {
  if (!definition.price) return;
  if (!definition.marketPath) throw new Error("action-price-unavailable");
  const market = executionMarket(input(action.params, definition.marketPath));
  if (!definition.price.markets.some((id) => id.toLowerCase() === market.toLowerCase())) throw new Error("action-price-unavailable");
  const direction = String(input(action.params, definition.price.directionPath));
  const isMax = definition.price.maximumDirections.includes(direction);
  if (!isMax && !definition.price.minimumDirections.includes(direction)) throw new Error("action-price-invalid");
  const rawSlippage = input(action.params, definition.price.slippagePath);
  if (!/^\d+$/.test(String(rawSlippage))) throw new Error("action-price-invalid");
  const slippageBps = Number(rawSlippage);
  const protection = await client.rpc.read<`0x${string}`>(client.config.core, coreAbi, "priceProtection");
  const rule = await client.rpc.read<{ oracle: `0x${string}`; feedId: `0x${string}`; priceDecimals: number;
    maxSlippageBps: number; maxAuthorizationAge: number }>(protection, protectionAbi, "rule",
      [bundle, keccak256(stringToHex(definition.capability)), market]);
  const houseCap = await client.rpc.read<number>(protection, protectionAbi, "houseSlippage", [creditId]);
  if (!rule || /^0x0{40}$/i.test(rule.oracle) || !Number.isInteger(slippageBps)
    || slippageBps < 0 || slippageBps > Math.min(houseCap, rule.maxSlippageBps)) throw new Error("action-slippage-denied");
  if (previous) {
    if (previous.slippageBps !== slippageBps || previous.isMax !== isMax
      || previous.bound !== deriveExecutionBound(previous.referencePrice, slippageBps, isMax, rule.priceDecimals)) {
      throw new Error("action-review-stale");
    }
    return previous;
  }
  const [value, block] = await Promise.all([
    client.rpc.read<readonly [bigint, bigint, bigint]>(rule.oracle, oracleAbi, "read", [rule.feedId]),
    client.rpc.client.getBlock({ blockTag: "latest" }),
  ]);
  return { roundId: value[2], referencePrice: value[0], updatedAt: value[1], authorizedAt: block.timestamp,
    bound: deriveExecutionBound(value[0], slippageBps, isMax, rule.priceDecimals), slippageBps, isMax };
}
