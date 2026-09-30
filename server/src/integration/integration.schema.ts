import { z } from "zod";
import { capabilityCalls, capabilityDefinitionSchema } from "@termbook/schema";
import { parseAbiItem } from "viem";
import { applicationIdSchema } from "./application.schema.js";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/).refine((value) => !/^0x0{64}$/i.test(value));
export const integrationAcceptanceSchema = z.strictObject({
  evidenceHash: word,
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
  category: z.enum(["perps", "staking", "vault", "liquidity", "spot"]),
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
  for (const [index, action] of value.actions.entries()) {
    if (names.has(action.capability)) ctx.addIssue({ code: "custom", path: ["actions", index, "capability"], message: "capability-duplicate" });
    names.add(action.capability);
    try {
      for (const call of capabilityCalls(action)) {
      const item = parseAbiItem(call.signature);
      if (item.type !== "function" || item.stateMutability !== "nonpayable" || item.inputs.length !== call.arguments.length) throw new Error();
      const fundingPath = call.fundingPath;
      if (fundingPath && !call.arguments.some((arg) => arg.source === "input" && arg.path
        && (fundingPath === arg.path || fundingPath.startsWith(`${arg.path}.`)))) throw new Error();
      }
    } catch {
      ctx.addIssue({ code: "custom", path: ["actions", index], message: "capability-definition-invalid" });
    }
  }
  if (value.category === "perps" && (!names.has("place_order") || !names.has("close_position"))) {
    ctx.addIssue({ code: "custom", path: ["actions"], message: "perps-lifecycle-incomplete" });
  }
  const targets = new Set(value.actions.flatMap(capabilityCalls).map((action) => action.target.toLowerCase()));
  const sources = value.verifiedSources.map((source) => source.target.toLowerCase());
  if (new Set(sources).size !== sources.length || sources.length !== targets.size
    || sources.some((target) => !targets.has(target))) {
    ctx.addIssue({ code: "custom", path: ["verifiedSources"], message: "integration-source-evidence-incomplete" });
  }
});

export const integrationSchema = integrationMappingSchema.safeExtend({ acceptance: integrationAcceptanceSchema });
