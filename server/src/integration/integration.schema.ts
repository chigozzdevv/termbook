import { z } from "zod";
import { assertActionRoutes, assertStandardDefinition, capabilityCalls, capabilityDependencies, capabilityDefinitionSchema, integrationSuiteSchema, useCaseSchema } from "@termbook/schema";
import { parseAbiItem } from "viem";
import { applicationIdSchema } from "./application.schema.js";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/).refine((value) => !/^0x0{64}$/i.test(value));
export const integrationAcceptanceSchema = z.strictObject({
  evidenceHash: word,
  suite: integrationSuiteSchema,
  activeCreditId: word,
  recoveredCreditId: word,
  actionTransactions: z.record(z.string().min(1), z.strictObject({ creditId: word, txHash: word })),
  recoveryTxHashes: z.array(word).min(1).max(32),
  repaymentTxHash: word,
}).refine((value) => value.activeCreditId.toLowerCase() !== value.recoveredCreditId.toLowerCase(), {
  message: "integration-sample-duplicate",
});

export const integrationDraftSchema = z.strictObject({
  entries: z.array(z.strictObject({
    target: z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine((value) => !/^0x0{40}$/i.test(value)),
    codeHash: word,
    implementationCodeHash: word.optional(),
    signature: z.string().min(1).max(512),
    txHash: word,
  })).min(1).max(32),
});

export const integrationDraftRequestSchema = integrationDraftSchema.extend({ applicationId: applicationIdSchema });

export const integrationMappingSchema = z.strictObject({
  applicationId: applicationIdSchema,
  category: useCaseSchema,
  versionId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  codeHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  settlementAsset: z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine((value) => !/^0x0{40}$/i.test(value)),
  actions: z.array(capabilityDefinitionSchema).min(1).max(32),
  verifiedSources: z.array(z.strictObject({
    target: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    sourceHash: word,
    implementation: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    implementationSourceHash: word.optional(),
  })).min(1).max(32),
}).superRefine((value, ctx) => {
  const names = new Set<string>();
  try { assertActionRoutes(value.actions); } catch (error) {
    ctx.addIssue({ code: "custom", path: ["actions"], message: (error as Error).message });
  }
  for (const [index, action] of value.actions.entries()) {
    names.add(action.capability);
    try {
      assertStandardDefinition(action, value.category);
      if (action.positionState) {
        const read = parseAbiItem(action.positionState.signature);
        if (read.type !== "function" || !["view", "pure"].includes(read.stateMutability)
          || read.inputs.length !== action.positionState.arguments.length || !read.outputs.every((arg) => /^(?:uint(?:\d{0,3})|bytes32)$/.test(arg.type))
          || Math.max(action.positionState.marketIndex, action.positionState.directionIndex) >= read.outputs.length
          || action.positionState.marketIndex === action.positionState.directionIndex
          || action.positionState.directions.long === action.positionState.directions.short
          || action.positionState.arguments.some((arg) => !["input", "credit_account", "credit_id", "constant"].includes(arg.source))
          || !action.positionState.arguments.some((arg) => arg.source === "credit_account")
          || !action.positionState.arguments.some((arg) => arg.source === "input" && arg.path === "position_id")) throw new Error();
      }
      for (const call of capabilityCalls(action)) {
      if (action.orderSizing && [call.fundingPath, call.spendPath, call.valuePath].includes("_derived.order_spend")) {
        const inputAsset = action.when?.direction === "buy" ? action.orderSizing.quoteAsset : action.orderSizing.baseAsset;
        if (call.valuePath === "_derived.order_spend" ? !/^0x0{40}$/i.test(inputAsset)
          : (call.spendToken ?? value.settlementAsset).toLowerCase() !== inputAsset.toLowerCase()) throw new Error();
      }
      const item = parseAbiItem(call.signature);
      if (item.type !== "function" || !["nonpayable", "payable"].includes(item.stateMutability) || item.inputs.length !== call.arguments.length) throw new Error();
      if ((call.valuePath || call.valueFromBound || call.nativeValue !== undefined) && item.stateMutability !== "payable") throw new Error();
      if ((call.fundingFromBound && call.fundingPath) || (call.spendFromBound && (call.spendPath || call.fundingPath))
        || (call.valueFromBound && call.valuePath)) throw new Error();
      if ([call.fundingPath, call.fundingAmount, call.fundingFromBound || undefined].filter((v) => v !== undefined).length > 1
        || [call.spendPath ?? call.fundingPath, call.spendAmount, call.spendFromBound || call.fundingFromBound || undefined].filter((v) => v !== undefined).length > 1
        || [call.valuePath, call.nativeValue, call.valueFromBound || undefined].filter((v) => v !== undefined).length > 1
        || [call.fundingAmount, call.spendAmount, call.nativeValue].some((v) => v !== undefined && BigInt(v) >= 2n ** 256n)) throw new Error();
      if ((call.fundingFromBound || call.spendFromBound || call.valueFromBound)
        && (action.price?.kind !== "max_input" || !call.arguments.some((arg) => arg.source === "price_bound"))) throw new Error();
      if ((call.fundingPath || call.fundingFromBound || call.fundingAmount !== undefined) && call.spendToken && call.spendToken.toLowerCase() !== value.settlementAsset.toLowerCase()) throw new Error();
      const fundingPath = call.fundingPath;
      if (fundingPath && !(action.orderSizing && fundingPath === "_derived.order_spend") && !call.arguments.some((arg) => arg.source === "input" && arg.path
        && (fundingPath === arg.path || fundingPath.startsWith(`${arg.path}.`)))) throw new Error();
      }
    } catch {
      ctx.addIssue({ code: "custom", path: ["actions", index], message: "capability-definition-invalid" });
    }
  }
  if (value.category === "perps" && (!names.has("place_order") || !names.has("close_position"))) {
    ctx.addIssue({ code: "custom", path: ["actions"], message: "perps-lifecycle-incomplete" });
  }
  if (value.category === "perps" && value.actions.some((action) => ["place_order", "close_position", "decrease_position", "increase_position"].includes(action.capability) && !action.price)) {
    ctx.addIssue({ code: "custom", path: ["actions"], message: "perps-price-protection-required" });
  }
  for (const [index, action] of value.actions.entries()) {
    if (value.category === "spot" && action.capability !== "cancel_order"
      && (!action.price || action.settlement === "atomic" && (action.price.kind ?? "price") === "price")) {
      ctx.addIssue({ code: "custom", path: ["actions", index], message: "spot-amount-protection-required" });
    }
    const bounds = capabilityCalls(action).flatMap((call) => call.arguments.filter((arg) => arg.source === "price_bound"));
    if (action.price ? !action.marketPath || bounds.length === 0 : bounds.length !== 0) {
      ctx.addIssue({ code: "custom", path: ["actions", index], message: "capability-price-definition-invalid" });
    }
  }
  const targets = new Set(value.actions.flatMap(capabilityDependencies).map((action) => action.target.toLowerCase()));
  const sources = value.verifiedSources.map((source) => source.target.toLowerCase());
  if (new Set(sources).size !== sources.length || sources.length !== targets.size
    || sources.some((target) => !targets.has(target))) {
    ctx.addIssue({ code: "custom", path: ["verifiedSources"], message: "integration-source-evidence-incomplete" });
  }
});

export const integrationSchema = integrationMappingSchema.safeExtend({ acceptance: integrationAcceptanceSchema });
