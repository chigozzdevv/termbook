import { encodeFunctionData, parseAbiItem } from "viem";
import { actionInputs, capabilityCalls, type CapabilityDefinition, type TermAction } from "@termbook/schema";

function atPath(params: Record<string, unknown>, path: string): unknown {
  let value: unknown = params;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) && !/^(?:[0-9]|1[0-5])$/.test(part) || !Object.prototype.hasOwnProperty.call(value, part)) {
      throw new Error("action-input-required");
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function validateActionCall(definition: CapabilityDefinition, action: TermAction, borrower: `0x${string}`): void {
  const params = actionInputs(definition, action);
  for (const call of capabilityCalls(definition)) {
  const item = parseAbiItem(call.signature);
  if (item.type !== "function" || item.inputs.length !== call.arguments.length) throw new Error("action-definition-invalid");
  const args = call.arguments.map((argument) => {
    if (argument.source === "borrower") return borrower;
    if (argument.source === "credit_account") return `0x${"1".repeat(40)}`;
    if (argument.source === "price_bound") return 1n;
    if (argument.source === "credit_id") return `0x${"1".repeat(64)}`;
    if (argument.source === "constant") return argument.value;
    if (argument.source === "state") return argument.choices?.long ?? "1";
    const value = atPath(params, argument.path!);
    return argument.choices && typeof value === "string" ? argument.choices[value] : value;
  });
  try { encodeFunctionData({ abi: [item], functionName: item.name, args: args as never }); }
  catch { throw new Error("action-input-invalid"); }
  }
}
