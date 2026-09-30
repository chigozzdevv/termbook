import { actionFunding, type CapabilityDefinition, type CapabilityCall } from "@termbook/schema";
import { encodeFunctionData, parseAbiItem, type AbiParameter } from "viem";
import type { AppAction } from "../types/app.types.js";

export type ActionContext = { borrower: `0x${string}`; account: `0x${string}`; creditId: `0x${string}`; priceBound?: bigint };

function atPath(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)
      || !Object.prototype.hasOwnProperty.call(current, part)) throw new Error("action-input-required");
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function integer(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error("action-input-invalid");
}

function coerce(parameter: AbiParameter, value: unknown, depth = 0): unknown {
  if (depth > 4) throw new Error("action-input-invalid");
  const type = parameter.type;
  const array = /^(.*)\[(\d*)\]$/.exec(type);
  if (array) {
    if (!Array.isArray(value) || value.length > 16 || array[2] && value.length !== Number(array[2])) throw new Error("action-input-invalid");
    return value.map((part) => coerce({ ...parameter, type: array[1]! }, part, depth + 1));
  }
  if (type === "tuple") {
    const components = "components" in parameter ? parameter.components as readonly AbiParameter[] : undefined;
    if (!components || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("action-input-invalid");
    const entries = value as Record<string, unknown>;
    if (Object.keys(entries).length !== components.length) throw new Error("action-input-invalid");
    return components.map((part) => {
      if (!part.name || !Object.prototype.hasOwnProperty.call(entries, part.name)) throw new Error("action-input-invalid");
      return coerce(part, entries[part.name], depth + 1);
    });
  }
  if (/^u?int(?:\d{0,3})$/.test(type)) {
    const result = integer(value);
    if (type.startsWith("uint") && result < 0n) throw new Error("action-input-invalid");
    return result;
  }
  if (type === "bool") {
    if (typeof value !== "boolean") throw new Error("action-input-invalid");
    return value;
  }
  if (type === "address") {
    if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error("action-input-invalid");
    return value;
  }
  if (/^bytes(?:\d{0,2})$/.test(type)) {
    const size = type === "bytes" ? 256 : Number(type.slice(5));
    if (typeof value !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/.test(value)
      || value.length > size * 2 + 2 || type !== "bytes" && value.length !== size * 2 + 2) throw new Error("action-input-invalid");
    return value;
  }
  if (type === "string" && typeof value === "string" && value.length <= 256) return value;
  throw new Error("action-type-unsupported");
}

export function buildAction(definition: CapabilityDefinition, action: AppAction, context: ActionContext): {
  target: `0x${string}`; data: `0x${string}`; requiredInput: bigint;
} {
  if (definition.capability !== action.capability || "target" in action || "data" in action
    || "encoded_params" in action.params || "encodedParams" in action.params) throw new Error("capability-denied");
  const requiredInput = actionFunding(definition, action);
  return { ...buildCapabilityCall(definition, action, context), requiredInput };
}

export function buildCapabilityCall(definition: CapabilityCall, action: AppAction, context: ActionContext): {
  target: `0x${string}`; data: `0x${string}`;
} {
  const item = parseAbiItem(definition.signature);
  if (item.type !== "function" || item.inputs.length !== definition.arguments.length) throw new Error("action-definition-invalid");
  const values = definition.arguments.map((argument, index) => {
    let value: unknown;
    if (argument.source === "input") {
      value = atPath(action.params, argument.path!);
      if (argument.choices) {
        if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(argument.choices, value)) throw new Error("action-input-invalid");
        value = argument.choices[value];
      }
    } else if (argument.source === "borrower") value = context.borrower;
    else if (argument.source === "credit_account") value = context.account;
    else if (argument.source === "credit_id") value = context.creditId;
    else {
      if (context.priceBound === undefined) throw new Error("action-price-required");
      value = context.priceBound;
    }
    return coerce(item.inputs[index]!, value);
  });
  const data = encodeFunctionData({ abi: [item], functionName: item.name, args: values });
  return { target: definition.target as `0x${string}`, data };
}
