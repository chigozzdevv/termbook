import { z } from "zod";
import { capabilityDefinitionSchema } from "@termbook/schema";
import { parseAbiItem } from "viem";

const word = z.string().regex(/^0x[a-fA-F0-9]{64}$/).refine((value) => !/^0x0{64}$/i.test(value));
export const integrationAcceptanceSchema = z.strictObject({
  evidenceHash: word,
  activeCreditId: word,
  recoveredCreditId: word,
  actionTransactions: z.record(z.string().min(1), z.strictObject({ creditId: word, txHash: word })),
  recoveryTxHashes: z.array(word).min(1).max(32),
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

export const integrationSchema = z.strictObject({
  versionId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  codeHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  settlementAsset: z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine((value) => !/^0x0{40}$/i.test(value)),
  actions: z.array(capabilityDefinitionSchema).min(1).max(32),
  acceptance: integrationAcceptanceSchema,
}).superRefine((value, ctx) => {
  const names = new Set<string>();
  for (const [index, action] of value.actions.entries()) {
    if (names.has(action.capability)) ctx.addIssue({ code: "custom", path: ["actions", index, "capability"], message: "capability-duplicate" });
    names.add(action.capability);
    try {
      const item = parseAbiItem(action.signature);
      if (item.type !== "function" || item.stateMutability !== "nonpayable" || item.inputs.length !== action.arguments.length) throw new Error();
      const fundingPath = action.fundingPath;
      if (fundingPath && !action.arguments.some((arg) => arg.source === "input" && arg.path
        && (fundingPath === arg.path || fundingPath.startsWith(`${arg.path}.`)))) throw new Error();
    } catch {
      ctx.addIssue({ code: "custom", path: ["actions", index], message: "capability-definition-invalid" });
    }
  }
});
