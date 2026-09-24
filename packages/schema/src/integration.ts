import { z } from "zod";
import { addressSchema, bytes32Schema } from "./auth.js";

export const capabilitySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const actionSchema = z.strictObject({
  capability: capabilitySchema,
  params: z.record(z.string(), z.unknown()),
});

const parameterPathSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*){0,4}$/);

export const capabilityArgumentSchema = z.strictObject({
  source: z.enum(["input", "borrower", "credit_account", "credit_id"]),
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

export const capabilityDefinitionSchema = z.strictObject({
  capability: capabilitySchema,
  label: z.string().min(1).max(80),
  target: addressSchema,
  signature: z.string().min(10).max(500),
  arguments: z.array(capabilityArgumentSchema).max(24),
  fundingPath: parameterPathSchema.optional(),
  settlement: z.enum(["atomic", "asynchronous"]),
});

export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>;

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

export function actionFunding(definition: CapabilityDefinition, action: TermAction): bigint {
  if (definition.capability !== action.capability) throw new Error("capability-denied");
  const allowed = definition.arguments.filter((arg) => arg.source === "input").map((arg) => arg.path!);
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
  for (const argument of definition.arguments) {
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
  if (!definition.fundingPath) return 0n;
  const value = inputAt(action.params, definition.fundingPath);
  if ((typeof value !== "bigint" && typeof value !== "number" && typeof value !== "string")
    || typeof value === "number" && !Number.isSafeInteger(value)
    || !/^\d+$/.test(String(value))) throw new Error("action-funding-invalid");
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error("action-funding-invalid");
  return amount;
}

export const bundleSchema = z.object({
  id: bytes32Schema,
  primary: bytes32Schema,
  deps: z.array(bytes32Schema),
});

export type TermAction = z.infer<typeof actionSchema>;
