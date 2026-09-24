import { z } from "zod";
import { capabilityDefinitionSchema } from "@termbook/schema";
import { parseAbiItem } from "viem";

export const integrationSchema = z.strictObject({
  versionId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  codeHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  actions: z.array(capabilityDefinitionSchema).min(1).max(32),
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
