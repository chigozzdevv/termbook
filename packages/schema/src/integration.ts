import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";
import { assertStandardAction, useCaseSchema, type UseCase } from "./actions.js";
export { useCaseSchema, type UseCase } from "./actions.js";

export const capabilitySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const actionSchema = z.strictObject({
  use_case: useCaseSchema.optional(),
  capability: capabilitySchema,
  params: z.record(z.string(), z.unknown()),
});

const parameterPathSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.(?:[a-zA-Z_][a-zA-Z0-9_]*|[0-9]|1[0-5])){0,4}$/);

export const capabilityArgumentSchema = z.strictObject({
  source: z.enum(["input", "borrower", "credit_account", "credit_id", "price_bound", "constant", "state"]),
  path: parameterPathSchema.optional(),
  value: z.union([z.string().max(256), z.boolean()]).optional(),
  label: z.string().min(1).max(80).optional(),
  min: z.string().regex(/^\d+$/).optional(),
  max: z.string().regex(/^\d+$/).optional(),
  singleton: z.boolean().optional(),
  scale: z.strictObject({ numerator: z.string().regex(/^[1-9]\d{0,77}$/), denominator: z.string().regex(/^[1-9]\d{0,77}$/) }).optional(),
  choices: z.record(z.string().min(1).max(80), z.union([z.string(), z.boolean()])).optional(),
}).superRefine((value, ctx) => {
  if (["input", "state"].includes(value.source) && !value.path) ctx.addIssue({ code: "custom", message: "action-input-path-required" });
  if (!["input", "state"].includes(value.source) && (value.path || value.min || value.max || value.choices)) {
    ctx.addIssue({ code: "custom", message: "action-internal-argument-invalid" });
  }
  if ((value.singleton || value.scale) && !["input", "state"].includes(value.source)) ctx.addIssue({ code: "custom", message: "action-transform-invalid" });
  if ((value.source === "constant") !== (value.value !== undefined)) ctx.addIssue({ code: "custom", message: "action-constant-invalid" });
  if (value.min && value.max && BigInt(value.min) > BigInt(value.max)) {
    ctx.addIssue({ code: "custom", message: "action-bounds-invalid" });
  }
});

export const capabilityCallSchema = z.strictObject({
  target: addressSchema,
  signature: z.string().min(10).max(500),
  arguments: z.array(capabilityArgumentSchema).max(24),
  fundingPath: parameterPathSchema.optional(),
  fundingAmount: z.string().regex(/^\d{1,78}$/).optional(),
  spendPath: parameterPathSchema.optional(),
  spendAmount: z.string().regex(/^\d{1,78}$/).optional(),
  valuePath: parameterPathSchema.optional(),
  nativeValue: z.string().regex(/^\d{1,78}$/).optional(),
  fundingFromBound: z.boolean().optional(),
  spendFromBound: z.boolean().optional(),
  valueFromBound: z.boolean().optional(),
  spendToken: addressSchema.optional(),
});

export const capabilityDefinitionSchema = capabilityCallSchema.extend({
  capability: capabilitySchema,
  label: z.string().min(1).max(80),
  settlement: z.enum(["atomic", "asynchronous"]),
  steps: z.array(capabilityCallSchema).max(7).optional(),
  marketPath: parameterPathSchema.optional(),
  exposurePath: parameterPathSchema.optional(),
  executionKey: capabilitySchema.optional(),
  when: z.strictObject({
    market_id: z.string().min(1).max(128).optional(),
    direction: z.enum(["buy", "sell", "long", "short"]).optional(),
    order_type: z.enum(["market", "limit"]).optional(),
    sizing: z.enum(["spend", "receive"]).optional(),
  }).optional(),
  expiry: z.enum(["native", "none"]).optional(),
  orderSizing: z.strictObject({
    baseAsset: addressSchema, quoteAsset: addressSchema,
    baseDecimals: z.number().int().min(0).max(36), quoteDecimals: z.number().int().min(0).max(36),
    feeBps: z.number().int().min(0).max(1000), lotSize: z.string().regex(/^[1-9]\d{0,77}$/),
  }).optional(),
  positionState: z.strictObject({
    target: addressSchema, signature: z.string().min(10).max(500), arguments: z.array(capabilityArgumentSchema).max(8),
    marketIndex: z.number().int().min(0).max(15), directionIndex: z.number().int().min(0).max(15),
    directions: z.strictObject({ long: z.string().regex(/^\d+$/), short: z.string().regex(/^\d+$/) }),
  }).optional(),
  price: z.strictObject({
    slippagePath: parameterPathSchema.optional(),
    kind: z.enum(["price", "min_output", "max_input"]).optional(),
    amountPath: parameterPathSchema.optional(),
    directionPath: parameterPathSchema.optional(),
    maximumDirections: z.array(z.string().min(1).max(80)).min(1).max(16).optional(),
    minimumDirections: z.array(z.string().min(1).max(80)).min(1).max(16).optional(),
    markets: z.array(bytes32Schema).min(1).max(32),
  }).superRefine((value, ctx) => {
    if ((value.kind ?? "price") === "price" ? !value.directionPath || !value.maximumDirections || !value.minimumDirections || !!value.amountPath
      : !value.amountPath || !!value.directionPath || !!value.maximumDirections || !!value.minimumDirections) {
      ctx.addIssue({ code: "custom", message: "action-price-kind-invalid" });
    }
    const directions = [...value.maximumDirections ?? [], ...value.minimumDirections ?? []];
    if (new Set(directions).size !== directions.length || new Set(value.markets.map((id) => id.toLowerCase())).size !== value.markets.length) {
      ctx.addIssue({ code: "custom", message: "action-price-directions-invalid" });
    }
  }).optional(),
});

export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>;
export type CapabilityCall = z.infer<typeof capabilityCallSchema>;
export function capabilityCalls(definition: CapabilityDefinition): CapabilityCall[] {
  return [...definition.steps ?? [], definition];
}
export function capabilityDependencies(definition: CapabilityDefinition): CapabilityCall[] {
  return [...capabilityCalls(definition), ...definition.positionState ? [definition.positionState] : []];
}

export function executionKey(definition: CapabilityDefinition): string { return definition.executionKey ?? definition.capability; }
export function matchesAction(definition: CapabilityDefinition, action: TermAction): boolean {
  if (definition.capability !== action.capability) return false;
  return Object.entries(definition.when ?? {}).every(([key, value]) => key === "sizing"
    ? !!action.params.amount && typeof action.params.amount === "object" && Object.prototype.hasOwnProperty.call(action.params.amount, value!)
    : String(action.params[key]) === value);
}
export function selectCapability(definitions: CapabilityDefinition[], action: TermAction): CapabilityDefinition {
  const matches = definitions.filter((definition) => matchesAction(definition, action));
  if (matches.length !== 1) throw new Error(matches.length ? "action-route-ambiguous" : "capability-denied");
  return matches[0]!;
}
export function assertActionRoutes(definitions: CapabilityDefinition[]): void {
  const keys = definitions.map(executionKey);
  if (new Set(keys).size !== keys.length) throw new Error("action-route-key-duplicate");
  for (const [i, first] of definitions.entries()) for (const second of definitions.slice(i + 1)) {
    if (first.capability !== second.capability) continue;
    if (!["market_id", "direction", "order_type", "sizing"].some((key) => {
      const a = first.when?.[key as keyof NonNullable<CapabilityDefinition["when"]>];
      const b = second.when?.[key as keyof NonNullable<CapabilityDefinition["when"]>];
      return a !== undefined && b !== undefined && a !== b;
    })) throw new Error("action-route-ambiguous");
  }
}

export function actionInputs(definition: CapabilityDefinition, action: TermAction): Record<string, unknown> {
  assertStandardAction(action);
  if (!matchesAction(definition, action)) throw new Error("capability-denied");
  if ("_derived" in action.params) throw new Error("action-input-invalid");
  if (definition.when?.order_type === "limit" || definition.capability === "modify_order") {
    if (definition.expiry === "none" ? action.params.expires_at !== undefined : action.params.expires_at === undefined) throw new Error("action-expiry-unsupported");
  }
  if (!definition.orderSizing) return action.params;
  const sizing = definition.orderSizing;
  const params = action.params;
  const amount = params.amount as { spend?: string | bigint | number; receive?: string | bigint | number };
  const price = BigInt(String(params.limit_price));
  const isBuy = params.direction === "buy";
  const lot = BigInt(sizing.lotSize);
  const unit = 10n ** BigInt(sizing.baseDecimals) * 10n ** 18n;
  const rate = price * 10n ** BigInt(sizing.quoteDecimals);
  const fee = BigInt(isBuy ? 10000 + sizing.feeBps : 10000 - sizing.feeBps);
  const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
  if (!amount || price <= 0n || lot <= 0n || (amount.spend === undefined) === (amount.receive === undefined)) throw new Error("action-sizing-invalid");
  const size = BigInt(String(amount.spend ?? amount.receive));
  let quantity = isBuy ? amount.spend !== undefined ? size * unit * 10000n / (rate * fee) : size
    : amount.spend !== undefined ? size : ceil(size * unit * 10000n, rate * fee);
  quantity = amount.spend !== undefined ? quantity / lot * lot : ceil(quantity, lot) * lot;
  const spend = isBuy ? ceil(quantity * rate * fee, unit * 10000n) : quantity;
  if (quantity <= 0n || quantity >= 2n ** 256n || spend <= 0n || spend >= 2n ** 256n
    || amount.spend !== undefined && spend > size) throw new Error("action-sizing-invalid");
  return { ...params, _derived: { order_quantity: quantity, order_spend: spend } };
}

function inputAt(params: Record<string, unknown>, path: string): unknown {
  let value: unknown = params;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) && !/^(?:[0-9]|1[0-5])$/.test(part) || !Object.prototype.hasOwnProperty.call(value, part)) {
      throw new Error("action-input-required");
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function transformArgument(argument: z.infer<typeof capabilityArgumentSchema>, input: unknown): unknown {
  let value = input;
  if (argument.choices) {
    if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(argument.choices, value)) throw new Error("action-input-invalid");
    value = argument.choices[value];
  }
  if (argument.scale) {
    if (!/^\d{1,78}$/.test(String(value))) throw new Error("action-input-invalid");
    const numerator = BigInt(argument.scale.numerator), denominator = BigInt(argument.scale.denominator);
    const scaled = BigInt(String(value)) * numerator;
    if (scaled % denominator !== 0n || scaled / denominator >= 2n ** 256n) throw new Error("action-precision-invalid");
    value = scaled / denominator;
  }
  return argument.singleton ? [value] : value;
}

export function actionFunding(definition: CapabilityDefinition, action: TermAction, priceBound?: bigint): bigint {
  assertStandardAction(action);
  const params = actionInputs(definition, action);
  const calls = capabilityCalls(definition);
  const allowed = [...calls.flatMap((call) => call.arguments.filter((arg) => arg.source === "input").map((arg) => arg.path!)),
    ...calls.flatMap((call) => [call.spendPath, call.valuePath, call.fundingPath]).filter((path): path is string => !!path),
    ...[definition.marketPath, definition.exposurePath, definition.price?.slippagePath, definition.price?.directionPath, definition.price?.amountPath].filter((path): path is string => !!path)];
  allowed.push(...Object.keys(definition.when ?? {}).filter((key) => key !== "sizing"));
  if (definition.price && (action.params.order_type === "limit" || action.capability === "modify_order")) allowed.push("limit_price");
  if (definition.orderSizing) allowed.push(`amount.${definition.when?.sizing}`);
  const inspect = (value: Record<string, unknown>, prefix = "") => {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (allowed.includes(path)) continue;
      if (!allowed.some((item) => item.startsWith(`${path}.`)) || !child || typeof child !== "object") {
        throw new Error("action-input-invalid");
      }
      inspect(child as Record<string, unknown>, path);
    }
  };
  inspect(action.params);
  if (definition.price) {
    const slippage = definition.price.slippagePath ? inputAt(params, definition.price.slippagePath) : 0;
    const direction = definition.price.directionPath && !definition.price.directionPath.startsWith("_state.") ? inputAt(params, definition.price.directionPath) : undefined;
    if (!/^\d+$/.test(String(slippage)) || BigInt(String(slippage)) > 5_000n
      || (definition.price.kind ?? "price") === "price" && !definition.price.directionPath?.startsWith("_state.") && (typeof direction !== "string"
        || ![...definition.price.maximumDirections ?? [], ...definition.price.minimumDirections ?? []].includes(direction))) {
      throw new Error("action-price-invalid");
    }
  }
  for (const argument of calls.flatMap((call) => call.arguments)) {
    if (argument.source !== "input") continue;
    let value = inputAt(params, argument.path!);
    value = transformArgument({ ...argument, singleton: false }, value);
    if (argument.min !== undefined || argument.max !== undefined) {
      if ((typeof value !== "bigint" && typeof value !== "number" && typeof value !== "string")
        || typeof value === "number" && !Number.isSafeInteger(value)
        || !/^-?\d+$/.test(String(value))) throw new Error("action-input-invalid");
      const number = BigInt(value);
      if (argument.min !== undefined && number < BigInt(argument.min)
        || argument.max !== undefined && number > BigInt(argument.max)) throw new Error("action-input-invalid");
    }
  }
  let required = 0n;
  for (const call of calls) {
    if ([call.fundingPath, call.fundingAmount, call.fundingFromBound || undefined].filter((value) => value !== undefined).length > 1) throw new Error("action-definition-invalid");
    if (call.fundingAmount !== undefined) { required += BigInt(call.fundingAmount); continue; }
    if (call.fundingFromBound) {
      if (priceBound === undefined || priceBound <= 0n || priceBound >= 2n ** 256n || call.fundingPath) throw new Error("action-price-required");
      required += priceBound;
      continue;
    }
    if (!call.fundingPath) continue;
    const value = inputAt(params, call.fundingPath);
    if ((typeof value !== "bigint" && typeof value !== "number" && typeof value !== "string")
      || typeof value === "number" && !Number.isSafeInteger(value)
      || !/^\d+$/.test(String(value))) throw new Error("action-funding-invalid");
    const amount = BigInt(value);
    if (amount <= 0n) throw new Error("action-funding-invalid");
    required += amount;
  }
  if (required >= 2n ** 256n) throw new Error("action-input-invalid");
  return required;
}

export const bundleSchema = z.object({
  id: bytes32Schema,
  primary: bytes32Schema,
  deps: z.array(bytes32Schema),
});

export type TermAction = z.infer<typeof actionSchema>;

export function assertActionUseCase(action: TermAction, expected?: UseCase): void {
  if (action.use_case === undefined) return;
  if (!["perps", "spot", "staking", "vault", "liquidity"].includes(action.use_case)) throw new Error("action-use-case-invalid");
  if (!expected) throw new Error("action-use-case-unavailable");
  if (action.use_case !== expected) throw new Error("action-use-case-mismatch");
}
