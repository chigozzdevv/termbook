import { randomUUID } from "node:crypto";
import { canonicalEvidence, capabilityDependencies, pluginDefinitionSchema, type PluginDefinition } from "@termbook/schema";
import { verify_definition, atomic_configuration, atomicSpotAbi, readProgramAbi, use_case_configuration } from "@termbook/sdk";
import { useCaseReaderAbi, useCasePolicyAbi, useCaseRecoveryAbi, priceProtectionAbi } from "@termbook/bindings";
import { keccak256, stringToHex, parseAbi, encodeAbiParameters, type Hex, type Address } from "viem";
import { PackageModel } from "./package.model.js";
import { applicationService } from "./application.service.js";
import { integrationSchema, integrationAcceptanceSchema } from "./integration.schema.js";
import { integrationService } from "./integration.service.js";
import { validateIntegrationAcceptance } from "./integration.builder.js";
import { validateIntegrationSources } from "./integration.source.js";
import { monadClient } from "../chain/monad.client.js";
import { withTx } from "../database/transaction.js";
import { integrationRepo } from "./integration.repo.js";
import { env } from "../config/env.js";
import { platformService } from "./platform.service.js";
import type { z } from "zod";

export function package_identity(input: PluginDefinition) {
  const definition = pluginDefinitionSchema.parse(input);
  const hash = keccak256(stringToHex(canonicalEvidence(definition)));
  return { definition, hash, versionId: keccak256(stringToHex(`termbook.integration.v1:${definition.chain_id}:${hash}`)) };
}
function action_sources(definition: PluginDefinition) {
  const targets = new Set(definition.actions.flatMap(capabilityDependencies).map((c) => c.target.toLowerCase()));
  return definition.verified_sources.filter((s) => targets.has(s.target.toLowerCase())).map((source) => ({ target: source.target,
    sourceHash: source.source_hash, implementation: source.implementation, implementationSourceHash: source.implementation_source_hash }));
}
async function verify_sources(definition: PluginDefinition) {
  for (const expected of definition.verified_sources) {
    const actual = await platformService.source(expected.target as Address);
    const pin = definition.pins.find((p) => p.target.toLowerCase() === expected.target.toLowerCase())!;
    if (actual.code_hash.toLowerCase() !== pin.code_hash.toLowerCase() || actual.source_hash.toLowerCase() !== expected.source_hash.toLowerCase()
      || actual.implementation?.toLowerCase() !== expected.implementation?.toLowerCase()
      || actual.implementation_source_hash?.toLowerCase() !== expected.implementation_source_hash?.toLowerCase()
      || actual.implementation_code_hash?.toLowerCase() !== pin.implementation_code_hash?.toLowerCase()) throw new Error("integration-source-pin-mismatch");
  }
}
const coreAbi = parseAbi([
  "function integrationRegistry() view returns (address)",
  "function priceProtection() view returns (address)",
  "function executionManager() view returns (address)",
  "function exitVerifierOfBundle(bytes32) view returns (address)",
  "function appRecoveryAdapterOfBundle(bytes32) view returns (address)",
]);
const managerAbi = parseAbi([
  "function bundles(bytes32) view returns (address policy,address reader,bytes32 policyCodeHash,bytes32 readerCodeHash,bytes32 policyHash,uint8 maxPositions,uint8 maxPending,uint32 maxAge)",
]);
const registryAbi = parseAbi(["function dependencyValid(bytes32,address) view returns (bool)"]);

export async function verify_package_bindings(definition: PluginDefinition, versionId: Hex): Promise<void> {
  const chain = monadClient();
  const block = await chain.getBlock({ blockTag: "finalized" });
  const core = env.core as Address;
  await verify_definition(chain, definition, block.number);
  const [registry, manager, exit, recovery] = await Promise.all([
    chain.readContract({ address: core, abi: coreAbi, functionName: "integrationRegistry", blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "executionManager", blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "exitVerifierOfBundle", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "appRecoveryAdapterOfBundle", args: [versionId], blockNumber: block.number }),
  ]);
  const bundle = await chain.readContract({ address: manager, abi: managerAbi, functionName: "bundles", args: [versionId], blockNumber: block.number });
  const actual = { execution: bundle[0], reader: bundle[1], recovery, exit };
  if (Object.entries(actual).some(([key, value]) => value.toLowerCase() !== definition.contracts[key as keyof typeof actual].toLowerCase())) {
    throw new Error("integration-contract-binding-invalid");
  }
  for (const pin of definition.pins) {
    if (!await chain.readContract({ address: registry, abi: registryAbi, functionName: "dependencyValid",
      args: [versionId, pin.target as Address], blockNumber: block.number })) throw new Error("integration-dependency-guard-invalid");
  }
  if (definition.assessment) {
    const platform = platformService.useCase();
    if (Object.keys(definition.contracts).some((key) => definition.contracts[key as keyof typeof definition.contracts].toLowerCase()
      !== platform.contracts[key as keyof typeof platform.contracts]!.toLowerCase())
      || definition.assessment.read_program.toLowerCase() !== platform.read_program!.toLowerCase()) throw new Error("integration-platform-binding-invalid");
    const config = use_case_configuration(definition);
    for (const [address, abi, expected] of [
      [definition.contracts.reader, useCaseReaderAbi, config.reader_hash],
      [definition.contracts.execution, useCasePolicyAbi, config.policy_hash],
      [definition.contracts.recovery, useCaseRecoveryAbi, config.recovery_hash],
    ] as const) if (await chain.readContract({ address: address as Address, abi, functionName: "configurationHashes", args: [versionId], blockNumber: block.number }) !== expected) {
      throw new Error("integration-assessment-binding-invalid");
    }
    for (const program of config.programs) if (await chain.readContract({ address: config.assessment.read_program as Address, abi: readProgramAbi,
      functionName: "programHashes", args: [program.id], blockNumber: block.number }) !== program.hash) throw new Error("integration-assessment-binding-invalid");
    const protection = await chain.readContract({ address: core, abi: coreAbi, functionName: "priceProtection", blockNumber: block.number });
    for (const price of config.prices) {
      const actual = await chain.readContract({ address: protection, abi: priceProtectionAbi, functionName: "rule",
        args: [versionId, price.capability, price.market], blockNumber: block.number });
      if (canonical_wire(actual) !== canonical_wire(price.rule)) throw new Error("integration-price-binding-invalid");
      const amount = await chain.readContract({ address: protection, abi: priceProtectionAbi, functionName: "amountRules",
        args: [keccak256(encodeAbiParameters(parseAbi(["function key(bytes32,bytes32,bytes32)"])[0].inputs, [versionId, price.capability, price.market]))], blockNumber: block.number });
      if (price.amount ? canonical_wire(amount) !== canonical_wire(Object.values(price.amount)) : amount[5]) throw new Error("integration-price-binding-invalid");
    }
  }
  if (definition.atomic_spot) {
    const platform = platformService.spot();
    const { config, configuration_hash, route_hashes, quote_program } = atomic_configuration(definition);
    if (config.router.toLowerCase() !== platform.router!.toLowerCase() || config.module.toLowerCase() !== platform.module!.toLowerCase()
      || config.quote_source.toLowerCase() !== platform.read_program!.toLowerCase()) throw new Error("integration-platform-binding-invalid");
    const actual = await chain.readContract({ address: config.module as Address, abi: atomicSpotAbi,
      functionName: "configurationHashes", args: [versionId], blockNumber: block.number });
    if (actual !== configuration_hash) throw new Error("integration-spot-configuration-mismatch");
    for (const [index, route] of config.routes.entries()) {
      if (await chain.readContract({ address: config.router as Address, abi: atomicSpotAbi, functionName: "routeHashes",
        args: [route.id as Hex], blockNumber: block.number }) !== route_hashes[index]) throw new Error("integration-spot-configuration-mismatch");
    }
    if (await chain.readContract({ address: config.quote_source as Address, abi: readProgramAbi, functionName: "programHashes",
      args: [quote_program.id], blockNumber: block.number }) !== quote_program.hash) throw new Error("integration-spot-configuration-mismatch");
  }
}

function canonical_wire(value: unknown): string {
  return canonicalEvidence(JSON.parse(JSON.stringify(value, (_, item: unknown) => typeof item === "bigint" ? String(item)
    : typeof item === "string" && /^0x[0-9a-f]+$/i.test(item) ? item.toLowerCase() : item)));
}

export const packageService = {
  async validate(applicationId: string, owner: string, definitionInput: PluginDefinition,
    acceptanceInput: z.infer<typeof integrationAcceptanceSchema>) {
    await applicationService.requireVerified(applicationId, owner, true);
    const { definition, hash, versionId } = package_identity(definitionInput);
    if (!definition.assessment && !definition.atomic_spot) throw new Error("integration-assessment-required");
    if (definition.chain_id !== env.monadChainId) throw new Error("integration-chain-mismatch");
    const acceptance = integrationAcceptanceSchema.parse(acceptanceInput);
    const proposal = integrationSchema.parse({ applicationId, category: definition.use_case,
      versionId, codeHash: hash, settlementAsset: definition.settlement_asset, actions: definition.actions,
      verifiedSources: action_sources(definition), acceptance });
    if (acceptance.suite.actors.borrower.toLowerCase() !== owner.toLowerCase()) throw new Error("integration-validation-owner-mismatch");
    await verify_package_bindings(definition, versionId);
    await Promise.all([
      validateIntegrationAcceptance(versionId, definition.settlement_asset as Address, definition.actions, acceptance, hash),
      validateIntegrationSources(proposal.actions, proposal.verifiedSources),
      verify_sources(definition),
    ]);
    const id = randomUUID();
    await PackageModel.create({ id, applicationId, owner: owner.toLowerCase(), versionId, packageHash: hash,
      definition, proposal, status: "validated", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    return { id, passed: true, version_id: versionId, package_hash: hash, failures: [] };
  },

  async register(id: string, applicationId: string, owner: string) {
    const row = await PackageModel.findOne({ id, applicationId, owner: owner.toLowerCase() }).lean();
    if (!row) throw new Error("integration-validation-not-found");
    await applicationService.requireVerified(applicationId, owner, true);
    const { definition, hash, versionId } = package_identity(pluginDefinitionSchema.parse(row["definition"]));
    if (row["packageHash"] !== hash || row["versionId"] !== versionId) throw new Error("integration-validation-binding-invalid");
    if (row["status"] !== "active" && (!(row["expiresAt"] instanceof Date) || row["expiresAt"].getTime() <= Date.now())) {
      throw new Error("integration-validation-expired");
    }
    await verify_package_bindings(definition, versionId);
    if (row["status"] === "active") {
      const token = String(row["appToken"]);
      await integrationService.resolve(token);
      return { integration_id: id, version_id: versionId, status: "active" as const, app_token: token };
    }
    await PackageModel.updateOne({ id, status: "validated" }, { $set: { status: "awaiting_approval" } });
    return { integration_id: id, version_id: versionId, status: "awaiting_approval" as const };
  },

  async approve(id: string, reviewer: Address, forkReviewSignature?: Hex) {
    const row = await PackageModel.findOne({ id, status: "awaiting_approval" }).lean();
    if (!row || !(row["expiresAt"] instanceof Date) || row["expiresAt"].getTime() <= Date.now()) throw new Error("integration-validation-not-found");
    const proposal = integrationSchema.parse(row["proposal"]);
    const { definition, hash, versionId } = package_identity(pluginDefinitionSchema.parse(row["definition"]));
    if (row["packageHash"] !== hash || row["versionId"] !== versionId || proposal.codeHash !== hash || proposal.versionId !== versionId
      || proposal.applicationId !== row["applicationId"]
      || proposal.category !== definition.use_case || proposal.settlementAsset.toLowerCase() !== definition.settlement_asset.toLowerCase()
      || canonicalEvidence(proposal.actions) !== canonicalEvidence(definition.actions)
      || canonicalEvidence(proposal.verifiedSources) !== canonicalEvidence(action_sources(definition))) throw new Error("integration-validation-binding-invalid");
    await verify_package_bindings(definition, versionId);
    await verify_sources(definition);
    const prepared = await integrationService.prepare(proposal, { reviewer, forkReviewSignature });
    await withTx(async (session) => {
      await integrationRepo.create({ ...prepared.doc, packageDefinition: definition }, session);
      const update = await PackageModel.updateOne({ id, status: "awaiting_approval", expiresAt: { $gt: new Date() } },
        { $set: { status: "active", appToken: prepared.appToken, reviewer } }, { session });
      if (update.modifiedCount !== 1) throw new Error("integration-registration-conflict");
    });
    return { integration_id: id, version_id: versionId, status: "active" as const, app_token: prepared.appToken };
  },
};
