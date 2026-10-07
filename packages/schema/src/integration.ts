import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const capabilitySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const useCaseSchema = z.enum(["perps", "staking", "vault", "liquidity", "spot"]);
export type UseCase = z.infer<typeof useCaseSchema>;

export const actionSchema = z.strictObject({
  use_case: useCaseSchema.optional(),
  capability: capabilitySchema,
  params: z.record(z.string(), z.unknown()),
});

const parameterPathSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*){0,4}$/);

export const capabilityArgumentSchema = z.strictObject({
  source: z.enum(["input", "borrower", "credit_account", "credit_id", "price_bound"]),
  path: parameterPathSchema.optional(),
  label: z.string().min(1).max(80).optional(),
  min: z.string().regex(/^\d+$/).optional(),
  max: z.string().regex(/^\d+$/).optional(),
  choices: z.record(z.string().min(1).max(80), z.union([z.string(), z.boolean()])).optional(),
}).superRefine((value, ctx) => {
  if (value.source === "input" && !value.path) ctx.addIssue({ code: "custom", message: "action-input-path-required" });
  if (value.source !== "input" && (value.path || value.min || value.max || value.choices)) {
    ctx.addIssue({ code: "custom", message: "action-internal-argument-invalid" });
  }
  if (value.min && value.max && BigInt(value.min) > BigInt(value.max)) {
    ctx.addIssue({ code: "custom", message: "action-bounds-invalid" });
  }
});

export const capabilityCallSchema = z.strictObject({
  target: addressSchema,
  signature: z.string().min(10).max(500),
  arguments: z.array(capabilityArgumentSchema).max(24),
  fundingPath: parameterPathSchema.optional(),
  spendPath: parameterPathSchema.optional(),
  valuePath: parameterPathSchema.optional(),
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
  price: z.strictObject({
    slippagePath: parameterPathSchema,
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

function inputAt(params: Record<string, unknown>, path: string): unknown {
  let value: unknown = params;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, part)) {
      throw new Error("action-input-required");
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function actionFunding(definition: CapabilityDefinition, action: TermAction, priceBound?: bigint): bigint {
  if (definition.capability !== action.capability) throw new Error("capability-denied");
  const calls = capabilityCalls(definition);
  const allowed = [...calls.flatMap((call) => call.arguments.filter((arg) => arg.source === "input").map((arg) => arg.path!)),
    ...calls.flatMap((call) => [call.spendPath, call.valuePath, call.fundingPath]).filter((path): path is string => !!path),
    ...[definition.marketPath, definition.exposurePath, definition.price?.slippagePath, definition.price?.directionPath, definition.price?.amountPath].filter((path): path is string => !!path)];
  const inspect = (value: Record<string, unknown>, prefix = "") => {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (allowed.includes(path)) continue;
      if (!allowed.some((item) => item.startsWith(`${path}.`)) || !child || typeof child !== "object" || Array.isArray(child)) {
        throw new Error("action-input-invalid");
      }
      inspect(child as Record<string, unknown>, path);
    }
  };
  inspect(action.params);
  if (definition.price) {
    const slippage = inputAt(action.params, definition.price.slippagePath);
    const direction = definition.price.directionPath ? inputAt(action.params, definition.price.directionPath) : undefined;
    if (!/^\d+$/.test(String(slippage)) || BigInt(String(slippage)) > 5_000n
      || (definition.price.kind ?? "price") === "price" && (typeof direction !== "string"
        || ![...definition.price.maximumDirections ?? [], ...definition.price.minimumDirections ?? []].includes(direction))) {
      throw new Error("action-price-invalid");
    }
  }
  for (const argument of calls.flatMap((call) => call.arguments)) {
    if (argument.source !== "input") continue;
    let value = inputAt(action.params, argument.path!);
    if (argument.choices) {
      if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(argument.choices, value)) throw new Error("action-input-invalid");
      value = argument.choices[value];
    }
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
    if (call.fundingFromBound) {
      if (priceBound === undefined || priceBound <= 0n || priceBound >= 2n ** 256n || call.fundingPath) throw new Error("action-price-required");
      required += priceBound;
      continue;
    }
    if (!call.fundingPath) continue;
    const value = inputAt(action.params, call.fundingPath);
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
  if (!useCaseSchema.safeParse(action.use_case).success) throw new Error("action-use-case-invalid");
  if (!expected) throw new Error("action-use-case-unavailable");
  if (action.use_case !== expected) throw new Error("action-use-case-mismatch");
}
