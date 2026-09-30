import { capabilityCalls, type CapabilityDefinition } from "@termbook/schema";
import { encodeAbiParameters, keccak256, parseAbi, parseAbiItem, stringToHex, toFunctionSelector } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";

const coreAbi = parseAbi(["function priceProtection() view returns (address)"]);
const oracleAbi = parseAbi(["function read(bytes32) view returns (uint256,uint256,uint80)"]);
const abi = parseAbi([
  "function rule(bytes32,bytes32,bytes32) view returns ((address oracle,bytes32 feedId,address target,bytes4 selector,uint8 callIndex,uint8 priceDecimals,uint16 priceWord,uint16 directionWord,uint16 maxSlippageBps,uint16 maxDeviationBps,uint32 maxAuthorizationAge,uint256 maximumDirection,uint256 minimumDirection))",
  "function ruleHashes(bytes32) view returns (bytes32)",
]);
function numeric(value: unknown): bigint | undefined {
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return;
  return BigInt(value);
}
export async function admittedPrices(bundle: `0x${string}`, actions: CapabilityDefinition[], blockNumber: bigint,
  category?: string): Promise<boolean> {
  if (category === "perps" && actions.some((action) => ["place_order", "close_position", "reduce_position", "modify_order"].includes(action.capability) && !action.price)) return false;
  const priced = actions.filter((action) => action.price);
  if (actions.some((action) => !action.price && capabilityCalls(action).some((call) => call.arguments.some((arg) => arg.source === "price_bound")))) return false;
  if (!priced.length) return true;
  const chain = monadClient();
  const protection = await chain.readContract({ address: env.core as `0x${string}`, abi: coreAbi,
    functionName: "priceProtection", blockNumber });
  if (/^0x0{40}$/i.test(protection)) return false;
  for (const action of priced) {
    if (!action.marketPath || !action.price) return false;
    const calls = capabilityCalls(action);
    const bounds = calls.flatMap((call, callIndex) => call.arguments.flatMap((arg, index) =>
      arg.source === "price_bound" ? [{ call, callIndex, index }] : []));
    if (bounds.length !== 1) return false;
    const bound = bounds[0]!;
    const item = parseAbiItem(bound.call.signature);
    if (item.type !== "function" || !item.inputs.every((arg) => /^(?:u?int(?:\d{0,3})|address|bool|bytes\d{1,2})$/.test(arg.type))
      || !/^uint(?:\d{0,3})$/.test(item.inputs[bound.index]!.type)) return false;
    const directionIndex = bound.call.arguments.findIndex((arg) => arg.source === "input" && arg.path === action.price!.directionPath);
    if (directionIndex < 0) return false;
    const direction = bound.call.arguments[directionIndex]!;
    const capability = keccak256(stringToHex(action.capability));
    for (const market of action.price.markets) {
      const [rule, hash] = await Promise.all([
        chain.readContract({ address: protection, abi, functionName: "rule", args: [bundle, capability, market as `0x${string}`], blockNumber }),
        chain.readContract({ address: protection, abi, functionName: "ruleHashes", args: [keccak256(encodeAbiParameters(
          [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }], [bundle, capability, market as `0x${string}`]))], blockNumber }),
      ]);
      if (/^0x0{64}$/i.test(hash) || /^0x0{40}$/i.test(rule.oracle) || rule.callIndex !== bound.callIndex
        || rule.priceWord !== bound.index || rule.directionWord !== directionIndex
        || rule.target.toLowerCase() !== bound.call.target.toLowerCase() || rule.selector !== toFunctionSelector(item)
        || rule.maxAuthorizationAge === 0 || rule.maxSlippageBps > 5000 || rule.maxDeviationBps === 0) return false;
      const price = await chain.readContract({ address: rule.oracle, abi: oracleAbi, functionName: "read",
        args: [rule.feedId], blockNumber });
      if (price[0] === 0n || price[1] === 0n || price[2] === 0n) return false;
      for (const value of action.price.maximumDirections) {
        if (numeric(direction.choices ? direction.choices[value] : value) !== rule.maximumDirection) return false;
      }
      for (const value of action.price.minimumDirections) {
        if (numeric(direction.choices ? direction.choices[value] : value) !== rule.minimumDirection) return false;
      }
    }
  }
  return true;
}
