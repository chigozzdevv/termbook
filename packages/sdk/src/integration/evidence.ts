import { integrationSuiteSchema, type IntegrationSuite } from "@termbook/schema";
import type { PublicClient } from "viem";
import { package_integration } from "./plugin.js";
import { integrationEvidenceHash, type IntegrationValidationOptions } from "./validation.js";
import type { ValidationEnvironment, ValidationSession } from "./author.js";

export type RecordedValidation = {
  suite: IntegrationSuite;
  evidenceHash: string;
  probes: ValidationSession["probes"];
  lifecycle: ValidationSession["lifecycle"];
};

export function create_evidence_environment(input: {
  client: PublicClient; fork_client?: PublicClient; options: IntegrationValidationOptions; evidence: RecordedValidation;
}): ValidationEnvironment {
  const evidence = structuredClone(input.evidence);
  const suite = integrationSuiteSchema.parse(evidence.suite);
  if (integrationEvidenceHash(suite).toLowerCase() !== evidence.evidenceHash.toLowerCase()) throw new Error("integration-evidence-hash-invalid");
  if (input.options.checkpoint) throw new Error("integration-evidence-checkpoint-invalid");
  if (input.fork_client && suite.mode !== "fork") throw new Error("integration-fork-client-invalid");
  const { cases: recorded, exclusions, ...context } = suite;
  return { client: input.client, suite_client: input.fork_client, options: input.options, async prepare(request) {
    if (input.fork_client) {
      const block = await input.client.getBlock({ blockNumber: BigInt(context.sourceBlock.number) });
      if (block.hash.toLowerCase() !== context.sourceBlock.hash.toLowerCase()
        || await input.fork_client.getChainId() !== context.chainId) throw new Error("integration-fork-source-invalid");
    }
    const identity = package_integration(request.plugin);
    if (context.versionId.toLowerCase() !== identity.version_id || context.manifestHash.toLowerCase() !== identity.hash
      || context.chainId !== request.plugin.chain_id || context.actors.borrower.toLowerCase() !== request.wallet.address.toLowerCase()
      || request.version_id !== identity.version_id || request.manifest_hash !== identity.hash) throw new Error("integration-validation-binding-invalid");
    const funded = evidence.probes.filter((probe) => probe.action.use_case === "spot" && probe.action.capability === "place_order"
      && "direction" in probe.action.params && probe.action.params.direction === "buy");
    if (request.plugin.definition.atomic_spot && !funded.some((probe) => "amount" in probe.action.params && typeof probe.action.params.amount === "object"
      && "spend" in probe.action.params.amount && BigInt(probe.action.params.amount.spend) === request.amount)) {
      throw new Error("integration-validation-amount-mismatch");
    }
    const cases: ValidationSession["cases"] = {};
    for (const item of recorded) cases[item.id] = async (runner) => runner.replay(item);
    return { context: structuredClone(context), wallets: [], cases, exclusions: structuredClone(exclusions),
      probes: structuredClone(evidence.probes), lifecycle: structuredClone(evidence.lifecycle) };
  } };
}
