import { executionKey, type CapabilityDefinition } from "@termbook/schema";
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, encodeAbiParameters, keccak256, parseAbi, stringToHex } from "viem";
import type { TermbookClient } from "../client/client.js";
import type { TermAction } from "@termbook/schema";
import { executionMarket, type ExecutionPrice } from "./execution.js";

const coreAbi = parseAbi(["function priceProtection() view returns (address)"]);
const protectionAbi = parseAbi([
  "error Stale()",
  "function referenceVersion() pure returns (uint256)",
  "function currentPriceReference(bytes32,bytes32,bytes32) view returns (uint256 value,uint256 updatedAt,uint80 roundId,uint256 observedAt)",
  "function priceReference(bytes32,bytes32,bytes32) view returns (uint256 value,uint256 updatedAt,uint80 roundId,uint256 observedAt)",
  "function rule(bytes32,bytes32,bytes32) view returns ((address oracle,bytes32 feedId,address target,bytes4 selector,uint8 callIndex,uint8 priceDecimals,uint16 priceWord,uint16 directionWord,uint16 maxSlippageBps,uint16 maxDeviationBps,uint32 maxAuthorizationAge,uint256 maximumDirection,uint256 minimumDirection))",
  "function houseSlippage(bytes32) view returns (uint16)",
  "function amountRules(bytes32) view returns (uint16 amountWord,uint8 inputDecimals,uint8 outputDecimals,bool inverse,bool maxInput,bool active,address inputAsset,address outputAsset)",
]);
const oracleAbi = parseAbi(["function read(bytes32) view returns (uint256 value,uint256 updatedAt,uint80 roundId)",
  "function readRound(bytes32,uint80) view returns (uint256 value,uint256 updatedAt,uint80 roundId)"]);
function input(params: Record<string, unknown>, path: string): unknown {
  let value: unknown = params;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) && !/^(?:[0-9]|1[0-5])$/.test(key) || !Object.prototype.hasOwnProperty.call(value, key)) throw new Error("action-input-required");
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
  definition: CapabilityDefinition, action: TermAction, previous?: ExecutionPrice, state?: { market_id: unknown; direction: string }): Promise<ExecutionPrice | undefined> {
  if (!definition.price) return;
  if (!definition.marketPath) throw new Error("action-price-unavailable");
  const params = { ...action.params, ...(state ? { _state: state } : {}) };
  const market = executionMarket(input(params, definition.marketPath));
  if (!definition.price.markets.some((id) => id.toLowerCase() === market.toLowerCase())) throw new Error("action-price-unavailable");
  const kind = definition.price.kind ?? "price";
  const direction = definition.price.directionPath ? String(input(params, definition.price.directionPath)) : "";
  const isMax = kind === "price" ? !!definition.price.maximumDirections?.includes(direction) : kind === "max_input";
  if (kind === "price" && !isMax && !definition.price.minimumDirections?.includes(direction)) throw new Error("action-price-invalid");
  const limit = action.params.order_type === "limit" || action.capability === "modify_order";
  const rawSlippage = definition.price.slippagePath ? input(params, definition.price.slippagePath) : 0;
  if (!/^\d+$/.test(String(rawSlippage))) throw new Error("action-price-invalid");
  let slippageBps = Number(rawSlippage);
  const protection = await client.rpc.read<`0x${string}`>(client.config.core, coreAbi, "priceProtection");
  const rule = await client.rpc.read<{ oracle: `0x${string}`; feedId: `0x${string}`; priceDecimals: number;
    maxSlippageBps: number; maxAuthorizationAge: number }>(protection, protectionAbi, "rule",
      [bundle, keccak256(stringToHex(executionKey(definition))), market]);
  const houseCap = await client.rpc.read<number>(protection, protectionAbi, "houseSlippage", [creditId]);
  if (limit) slippageBps = Math.min(houseCap, rule.maxSlippageBps);
  if (!rule || /^0x0{40}$/i.test(rule.oracle) || !Number.isInteger(slippageBps)
    || slippageBps < 0 || slippageBps > Math.min(houseCap, rule.maxSlippageBps)) throw new Error("action-slippage-denied");
  let derive = (price: bigint) => deriveExecutionBound(price, slippageBps, isMax, rule.priceDecimals);
  if (limit) {
    if (kind !== "price" || definition.price.slippagePath) throw new Error("action-limit-definition-invalid");
    const requested = BigInt(String(action.params.limit_price));
    const scale = 10n ** BigInt(Math.abs(rule.priceDecimals - 18));
    const bound = rule.priceDecimals >= 18 ? requested * scale : isMax ? requested / scale : (requested + scale - 1n) / scale;
    derive = (price) => {
      const approved = deriveExecutionBound(price, slippageBps, isMax, rule.priceDecimals);
      if (bound <= 0n || bound >= 2n ** 256n || (isMax ? bound > approved : bound < approved)) throw new Error("action-limit-price-denied");
      return bound;
    };
  }
  if (kind !== "price") {
    const id = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [bundle, keccak256(stringToHex(executionKey(definition))), market]));
    const config = await client.rpc.read<readonly [number, number, number, boolean, boolean, boolean, `0x${string}`, `0x${string}`]>(
      protection, protectionAbi, "amountRules", [id]);
    if (!config[5] || config[4] !== isMax || !definition.price.amountPath) throw new Error("action-price-unavailable");
    const rawAmount = input(action.params, definition.price.amountPath);
    if (typeof rawAmount !== "bigint" && typeof rawAmount !== "string" && typeof rawAmount !== "number"
      || typeof rawAmount === "number" && !Number.isSafeInteger(rawAmount) || !/^\d+$/.test(String(rawAmount))) throw new Error("action-price-invalid");
    const amount = BigInt(String(rawAmount));
    derive = (price) => deriveExecutionAmountBound(price, amount, slippageBps, config[1], config[2], config[3], config[4]);
  }
  if (previous) {
    if (previous.slippageBps !== slippageBps || previous.isMax !== isMax
      || previous.bound !== derive(previous.referencePrice)) {
      throw new Error("action-review-stale");
    }
    return previous;
  }
  let referenceVersion = 0n;
  try { referenceVersion = await client.rpc.read<bigint>(protection, protectionAbi, "referenceVersion"); }
  catch (error) {
    const absent = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionZeroDataError) : undefined;
    if (!(absent instanceof ContractFunctionZeroDataError)) throw error;
  }
  if (referenceVersion !== 0n && referenceVersion !== 1n && referenceVersion !== 2n) throw new Error("action-price-version-unsupported");
  const readReference = async (): Promise<readonly bigint[]> => {
    if (referenceVersion === 2n) {
      return client.rpc.read<readonly bigint[]>(protection, protectionAbi, "currentPriceReference",
        [bundle, keccak256(stringToHex(executionKey(definition))), market]);
    }
    if (referenceVersion === 1n) {
      try {
        return await client.rpc.read<readonly bigint[]>(protection, protectionAbi, "priceReference",
          [bundle, keccak256(stringToHex(executionKey(definition))), market]);
      } catch (error) {
        const reverted = error instanceof BaseError ? error.walk((cause) => cause instanceof ContractFunctionRevertedError) : undefined;
        if (!(reverted instanceof ContractFunctionRevertedError) || reverted.data?.errorName !== "Stale") throw error;
      }
    }
    const current = await client.rpc.read<readonly [bigint, bigint, bigint]>(rule.oracle, oracleAbi, "read", [rule.feedId]);
    if (referenceVersion === 1n) {
      const historical = await client.rpc.read<readonly [bigint, bigint, bigint]>(rule.oracle, oracleAbi, "readRound", [rule.feedId, current[2]]);
      if (current.some((value, index) => value !== historical[index])) throw new Error("action-price-unavailable");
    }
    return current;
  };
  const [value, block] = await Promise.all([
    readReference(),
    client.rpc.client.getBlock({ blockTag: "latest" }),
  ]);
  return { roundId: value[2]!, referencePrice: value[0]!, updatedAt: value[1]!, authorizedAt: referenceVersion === 2n ? value[3]! : block.timestamp,
    bound: derive(value[0]!), slippageBps, isMax };
}

export function deriveExecutionAmountBound(price: bigint, amount: bigint, bps: number, inputDecimals: number,
  outputDecimals: number, inverse: boolean, maxInput: boolean): bigint {
  if (price <= 0n || amount <= 0n || amount >= 2n ** 256n || !Number.isInteger(bps) || bps < 0 || bps > 5000
    || !Number.isInteger(inputDecimals) || inputDecimals < 0 || inputDecimals > 36
    || !Number.isInteger(outputDecimals) || outputDecimals < 0 || outputDecimals > 36) throw new Error("action-price-invalid");
  if (maxInput) { [inputDecimals, outputDecimals] = [outputDecimals, inputDecimals]; inverse = !inverse; }
  let numerator = inverse ? 10n ** 18n : price;
  let denominator = inverse ? price : 10n ** 18n;
  if (outputDecimals > inputDecimals) numerator *= 10n ** BigInt(outputDecimals - inputDecimals);
  else denominator *= 10n ** BigInt(inputDecimals - outputDecimals);
  if (numerator >= 2n ** 256n || denominator >= 2n ** 256n) throw new Error("action-price-invalid");
  const divide = (num: bigint, den: bigint) => maxInput ? num / den : (num + den - 1n) / den;
  const fair = divide(amount * numerator, denominator);
  const bound = divide(fair * BigInt(maxInput ? 10000 + bps : 10000 - bps), 10000n);
  if (bound <= 0n || bound >= 2n ** 256n) throw new Error("action-price-invalid");
  return bound;
}
