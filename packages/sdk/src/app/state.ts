import type { CapabilityDefinition, TermAction } from "@termbook/schema";
import { parseAbiItem } from "viem";
import { buildCapabilityCall, type ActionContext } from "./action.js";
import type { TermbookClient } from "../client/client.js";

export async function readActionState(client: TermbookClient, definition: CapabilityDefinition, action: TermAction, context: ActionContext) {
  const state = definition.positionState;
  if (!state) return;
  const item = parseAbiItem(state.signature);
  if (item.type !== "function" || !["view", "pure"].includes(item.stateMutability)) throw new Error("action-state-definition-invalid");
  const call = buildCapabilityCall(state, action, context);
  const result = await client.rpc.client.call({ to: call.target, data: call.data, blockTag: "finalized" });
  if (!result.data) throw new Error("action-state-unavailable");
  const { decodeFunctionResult } = await import("viem");
  const decoded = decodeFunctionResult({ abi: [item], functionName: item.name, data: result.data });
  const values = item.outputs.length === 1 ? [decoded] : decoded as unknown[];
  const direction = String(values[state.directionIndex]);
  if (state.directions.long === state.directions.short || ![state.directions.long, state.directions.short].includes(direction)
    || values[state.marketIndex] === undefined) throw new Error("action-state-unavailable");
  return { market_id: values[state.marketIndex], direction: direction === state.directions.long ? "long" : "short" };
}
