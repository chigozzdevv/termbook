import { actionFunding, actionInputs, capabilityCalls, executionKey, type CapabilityDefinition, type TermAction } from "@termbook/schema";
import { encodeAbiParameters, keccak256, parseAbi, parseAbiItem, stringToHex, toFunctionSelector, toHex } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";

const coreAbi = parseAbi(["function priceProtection() view returns (address)"]);
const oracleAbi = parseAbi(["function read(bytes32) view returns (uint256,uint256,uint80)"]);
const abi = parseAbi([
  "function rule(bytes32,bytes32,bytes32) view returns ((address oracle,bytes32 feedId,address target,bytes4 selector,uint8 callIndex,uint8 priceDecimals,uint16 priceWord,uint16 directionWord,uint16 maxSlippageBps,uint16 maxDeviationBps,uint32 maxAuthorizationAge,uint256 maximumDirection,uint256 minimumDirection))",
  "function ruleHashes(bytes32) view returns (bytes32)",
  "function amountRules(bytes32) view returns (uint16 amountWord,uint8 inputDecimals,uint8 outputDecimals,bool inverse,bool maxInput,bool active,address inputAsset,address outputAsset)",
  "function deriveAmountBound(uint256,uint256,uint16,uint8,uint8,bool,bool) pure returns (uint256)",
]);
function numeric(value: unknown): bigint | undefined {
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value !== "string" || !/^(?:\d+|0x[a-fA-F0-9]+)$/.test(value)) return;
  return BigInt(value);
}

export async function actionFundingBound(bundle: `0x${string}`, definition: CapabilityDefinition, action: TermAction): Promise<bigint | undefined> {
  if (!capabilityCalls(definition).some((call) => call.fundingFromBound)) return;
  actionFunding(definition, action, 1n);
  const params = actionInputs(definition, action);
  if (definition.price?.kind !== "max_input" || !definition.marketPath || !definition.price.amountPath) throw new Error("action-price-unavailable");
  const at = (path: string) => path.split(".").reduce<unknown>((value, part) => value && typeof value === "object"
    && !Array.isArray(value) ? (value as Record<string, unknown>)[part] : undefined, params);
  const integer = (value: unknown) => {
    if (typeof value !== "bigint" && typeof value !== "string" && typeof value !== "number"
      || typeof value === "number" && !Number.isSafeInteger(value) || !/^\d+$/.test(String(value))) throw new Error("action-price-invalid");
    const number = BigInt(String(value));
    if (number >= 2n ** 256n) throw new Error("action-price-invalid");
    return number;
  };
  const rawMarket = at(definition.marketPath);
  const market = typeof rawMarket === "string" && /^0x[0-9a-fA-F]{64}$/.test(rawMarket)
    ? rawMarket as `0x${string}` : typeof rawMarket === "string" && !/^\d+$/.test(rawMarket)
      ? keccak256(stringToHex(rawMarket)) : toHex(integer(rawMarket), { size: 32 });
  if (!definition.price.markets.some((id) => id.toLowerCase() === market.toLowerCase())) throw new Error("action-price-unavailable");
  const chain = monadClient();
  const { number: blockNumber } = await chain.getBlock({ blockTag: "finalized" });
  const protection = await chain.readContract({ address: env.core as `0x${string}`, abi: coreAbi, functionName: "priceProtection", blockNumber });
  const capability = keccak256(stringToHex(executionKey(definition)));
  const id = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }], [bundle, capability, market]));
  const [rule, amount] = await Promise.all([
    chain.readContract({ address: protection, abi, functionName: "rule", args: [bundle, capability, market], blockNumber }),
    chain.readContract({ address: protection, abi, functionName: "amountRules", args: [id], blockNumber }),
  ]);
  if (!definition.price.slippagePath) throw new Error("action-price-unavailable");
  const bps = Number(integer(at(definition.price.slippagePath)));
  if (!amount[5] || !amount[4] || bps > rule.maxSlippageBps || bps > 5000) throw new Error("action-slippage-denied");
  const price = await chain.readContract({ address: rule.oracle, abi: oracleAbi, functionName: "read", args: [rule.feedId], blockNumber });
  return chain.readContract({ address: protection, abi, functionName: "deriveAmountBound",
    args: [price[0], integer(at(definition.price.amountPath)), bps, amount[1], amount[2], amount[3], true], blockNumber });
}
export async function admittedPrices(bundle: `0x${string}`, actions: CapabilityDefinition[], blockNumber: bigint,
  category?: string, settlementAsset?: string): Promise<boolean> {
  if (category === "perps" && actions.some((action) => ["place_order", "close_position", "decrease_position", "increase_position"].includes(action.capability) && !action.price)) return false;
  if (category === "spot" && actions.some((action) => action.capability !== "cancel_order"
    && (!action.price || action.settlement === "atomic" && (action.price.kind ?? "price") === "price"))) return false;
  const priced = actions.filter((action) => action.price);
  if (actions.some((action) => !action.price && capabilityCalls(action).some((call) => call.arguments.some((arg) => arg.source === "price_bound")))) return false;
  if (!priced.length) return true;
  const chain = monadClient();
  const protection = await chain.readContract({ address: env.core as `0x${string}`, abi: coreAbi,
    functionName: "priceProtection", blockNumber });
  if (/^0x0{40}$/i.test(protection)) return false;
  const results = await Promise.all(priced.map(async (action) => {
    if (!action.marketPath || !action.price) return false;
    const calls = capabilityCalls(action);
    const bounds = calls.flatMap((call, callIndex) => call.arguments.flatMap((arg, index) =>
      arg.source === "price_bound" ? [{ call, callIndex, index }] : []));
    if (!bounds.length) return false;
    for (const bound of bounds) {
      const item = parseAbiItem(bound.call.signature);
      if (item.type !== "function" || !item.inputs.every((arg) => /^(?:u?int(?:\d{0,3})|address|bool|bytes\d{1,2})$/.test(arg.type))
        || !/^uint(?:\d{0,3})$/.test(item.inputs[bound.index]!.type)) return false;
    }
    const amountMode = (action.price.kind ?? "price") !== "price";
    const capability = keccak256(stringToHex(executionKey(action)));
    for (const market of action.price.markets) {
      const [rule, hash] = await Promise.all([
        chain.readContract({ address: protection, abi, functionName: "rule", args: [bundle, capability, market as `0x${string}`], blockNumber }),
        chain.readContract({ address: protection, abi, functionName: "ruleHashes", args: [keccak256(encodeAbiParameters(
          [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }], [bundle, capability, market as `0x${string}`]))], blockNumber }),
      ]);
      const bound = bounds.find((entry) => entry.callIndex === rule.callIndex && entry.index === rule.priceWord);
      if (!bound) return false;
      const item = parseAbiItem(bound.call.signature);
      if (item.type !== "function") return false;
      const direction = bound.call.arguments[rule.directionWord];
      const directional = !amountMode || !!action.price.maximumDirections?.length || !!action.price.minimumDirections?.length;
      if (directional && (!direction || !(direction.source === "input" && direction.path === action.price.directionPath
        || direction.source === "state" && `_state.${direction.path}` === action.price.directionPath
        || direction.source === "constant" && action.when?.direction
          && [...action.price.maximumDirections ?? [], ...action.price.minimumDirections ?? []].includes(action.when.direction)))) return false;
      const amountIndex = bound.call.arguments.findIndex((arg) => arg.source === "input" && arg.path === action.price!.amountPath);
      if (amountMode && (amountIndex < 0 || !/^uint(?:\d{0,3})$/.test(item.inputs[amountIndex]!.type))) return false;
      if (/^0x0{64}$/i.test(hash) || /^0x0{40}$/i.test(rule.oracle)
        || rule.target.toLowerCase() !== bound.call.target.toLowerCase() || rule.selector !== toFunctionSelector(item)
        || rule.maxAuthorizationAge === 0 || rule.maxSlippageBps > 5000 || rule.maxDeviationBps === 0) return false;
      const price = await chain.readContract({ address: rule.oracle, abi: oracleAbi, functionName: "read",
        args: [rule.feedId], blockNumber });
      if (price[0] === 0n || price[1] === 0n || price[2] === 0n) return false;
      if (amountMode) {
        const amount = await chain.readContract({ address: protection, abi, functionName: "amountRules", args: [keccak256(encodeAbiParameters(
          [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }], [bundle, capability, market as `0x${string}`]))], blockNumber });
        if (!amount[5] || amount[0] !== amountIndex || amount[4] !== (action.price.kind === "max_input")) return false;
        if (/^0x0{40}$/i.test(amount[6]) ? !bound.call.valuePath && !bound.call.valueFromBound
          : (bound.call.spendToken ?? settlementAsset ?? "").toLowerCase() !== amount[6].toLowerCase()) return false;
      }
      for (const value of action.price.maximumDirections ?? []) {
        if (direction?.source === "constant" && value !== action.when?.direction) continue;
        if (numeric(direction?.source === "constant" ? direction.value : direction?.choices ? direction.choices[value] : value) !== rule.maximumDirection) return false;
      }
      for (const value of action.price.minimumDirections ?? []) {
        if (direction?.source === "constant" && value !== action.when?.direction) continue;
        if (numeric(direction?.source === "constant" ? direction.value : direction?.choices ? direction.choices[value] : value) !== rule.minimumDirection) return false;
      }
    }
    return true;
  }));
  return results.every(Boolean);
}
