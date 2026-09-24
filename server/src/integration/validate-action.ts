import { encodeFunctionData, parseAbiItem } from "viem";
import type { CapabilityDefinition, TermAction } from "@termbook/schema";

function atPath(params: Record<string, unknown>, path: string): unknown {
  let value: unknown = params;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, part)) {
      throw new Error("action-input-required");
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function validateActionCall(definition: CapabilityDefinition, action: TermAction, borrower: `0x${string}`): void {
  const item = parseAbiItem(definition.signature);
  if (item.type !== "function" || item.inputs.length !== definition.arguments.length) throw new Error("action-definition-invalid");
  const args = definition.arguments.map((argument) => {
    if (argument.source === "borrower") return borrower;
    if (argument.source === "credit_account") return `0x${"1".repeat(40)}`;
    if (argument.source === "credit_id") return `0x${"1".repeat(64)}`;
    const value = atPath(action.params, argument.path!);
    return argument.choices && typeof value === "string" ? argument.choices[value] : value;
  });
  try { encodeFunctionData({ abi: [item], functionName: item.name, args: args as never }); }
  catch { throw new Error("action-input-invalid"); }
}
