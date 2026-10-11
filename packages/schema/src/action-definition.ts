import { standardActionFields, type UseCase } from "./actions.js";
import { capabilityCalls, type CapabilityDefinition } from "./integration.js";

export function assertStandardDefinition(definition: CapabilityDefinition, category: UseCase): void {
  const params = { order_type: definition.when?.order_type ?? "market" };
  const fields = standardActionFields(category, definition.capability, params);
  const calls = capabilityCalls(definition);
  const paths = calls.flatMap((call) => call.arguments.filter((arg) => arg.source === "input").map((arg) => arg.path!));
  const used = new Set([...paths, ...Object.keys(definition.when ?? {}).filter((key) => key !== "sizing"),
    ...[definition.marketPath, definition.price?.slippagePath].filter((path): path is string => !!path)]);
  const limit = params.order_type === "limit" || definition.capability === "modify_order";
  if (!limit && fields.some((field) => field.path === "slippage_bps") && definition.price?.slippagePath !== "slippage_bps") {
    throw new Error("action-slippage-definition-invalid");
  }
  if (limit) used.add("limit_price");
  const allowed = new Set(fields.map((field) => field.path));
  for (const key of Object.keys(definition.when ?? {})) {
    if (key === "sizing" ? category !== "spot" || !allowed.has("amount") : !allowed.has(key)) throw new Error("action-route-definition-invalid");
  }
  if (category === "spot") { allowed.add("amount.spend"); allowed.add("amount.receive"); }
  for (const path of [...paths, ...calls.flatMap((call) => [call.fundingPath, call.spendPath, call.valuePath]).filter((path): path is string => !!path),
    ...[definition.marketPath, definition.exposurePath, definition.price?.slippagePath, definition.price?.amountPath,
      definition.price?.directionPath].filter((path): path is string => !!path)]) {
    if (!allowed.has(path) && !(allowed.has(path.split(".")[0]!) && /^(?:amounts_in|min_amounts_out)\.(?:[0-9]|1[0-5])\.(?:asset_id|amount_in|min_amount_out)$/.test(path))
      && !(definition.orderSizing && ["_derived.order_quantity", "_derived.order_spend"].includes(path))
      && !(definition.positionState && ["_state.market_id", "_state.direction"].includes(path))) throw new Error("action-parameter-path-invalid");
  }
  for (const field of fields.filter((field) => !field.optional && !(field.path === "expires_at" && definition.expiry === "none"))) {
    if (field.path === "amount" && category === "spot") {
      if (!definition.when?.sizing || !used.has(`amount.${definition.when.sizing}`) && !definition.orderSizing) throw new Error("action-sizing-definition-required");
    } else if (!used.has(field.path) && ![...used].some((path) => path.startsWith(`${field.path}.`))) throw new Error("action-parameter-unmapped");
  }
  if (limit && (!definition.price || (definition.price.kind ?? "price") !== "price" || definition.price.slippagePath
    || definition.settlement !== "asynchronous" || (definition.expiry === "none" ? paths.includes("expires_at") : !paths.includes("expires_at")))) throw new Error("action-limit-definition-invalid");
  if (definition.orderSizing && (category !== "spot" || !limit || !definition.when?.direction
    || !["buy", "sell"].includes(definition.when.direction) || !paths.includes("_derived.order_quantity")
    || definition.orderSizing.baseAsset.toLowerCase() === definition.orderSizing.quoteAsset.toLowerCase()
    || !calls.some((call) => [call.fundingPath, call.spendPath, call.valuePath].includes("_derived.order_spend")))) throw new Error("action-sizing-definition-invalid");
  if (category === "spot" && ["place_order", "modify_order"].includes(definition.capability)) {
    if (!definition.when?.direction || !definition.when.sizing || !definition.price || !definition.marketPath) throw new Error("action-route-definition-required");
    if (limit ? !definition.orderSizing : definition.price.kind !== (definition.when.sizing === "spend" ? "min_output" : "max_input")
      || definition.price.amountPath !== `amount.${definition.when.sizing}`) throw new Error("spot-amount-protection-required");
  }
  if (definition.positionState) {
    if (category !== "perps" || !definition.capability.endsWith("position") || !paths.includes("position_id")
      || definition.marketPath !== "_state.market_id" || definition.price?.directionPath !== "_state.direction"
      || !calls.some((call) => call.arguments.some((arg) => arg.source === "state" && arg.path === "direction"))) throw new Error("action-state-definition-invalid");
  }
  if (category === "perps" && ["place_order", "increase_position", "decrease_position", "close_position"].includes(definition.capability)
    && (!definition.price || (definition.price.kind ?? "price") !== "price" || definition.capability !== "place_order" && !definition.positionState)) throw new Error("perps-price-protection-required");
}
