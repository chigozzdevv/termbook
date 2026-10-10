import { createHash, randomBytes } from "node:crypto";
import { keccak256, parseAbi, parseAbiItem, toFunctionSelector } from "viem";
import { assertActionRoutes, assertStandardDefinition, capabilityCalls, capabilityDependencies, useCaseSchema, pluginDefinitionSchema, canonicalEvidence, type CapabilityDefinition } from "@termbook/schema";
import { verify_definition } from "@termbook/sdk";
import { stringToHex } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { integrationRepo } from "./integration.repo.js";
import { admittedPrices } from "./integration.price.js";
import { validateIntegrationAcceptance } from "./integration.builder.js";
import { assertSuiteEnvelope, requireForkReview, verifySuitePins } from "./integration.suite.js";
import { applicationService } from "./application.service.js";
import { integrationAcceptanceSchema, integrationSchema } from "./integration.schema.js";
import { validateIntegrationSources, verifyIntegrationSourcePins, type SourcePin } from "./integration.source.js";
import type { z } from "zod";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const tokenPattern = /^tbk_[a-f0-9]{64}$/;
const coreAbi = [
  { type: "function", name: "integrationRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "healthSource", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "riskEngine", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "exitVerifierOfBundle", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "appRecoveryAdapterOfBundle", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "exitVerifierCodeHash", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "appRecoveryAdapterCodeHash", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes32" }] },
] as const;
const registryAbi = [
  { type: "function", name: "versions", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes32" }, { type: "bool" }, { type: "bool" }] },
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "recoveryCallCount", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
] as const;
const healthAbi = [
  { type: "function", name: "isReaderActive", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "readers", stateMutability: "view", inputs: [{ type: "bytes32" }],
    outputs: [{ type: "address" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "bytes32" }] },
] as const;
const appHealthAbi = [
  { type: "function", name: "core", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "bundleId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "recoveryAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "appReader", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "appReaderCodeHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;
const callAbi = [{ type: "function", name: "isCallAllowed", stateMutability: "view",
  inputs: [{ type: "bytes32" }, { type: "address" }, { type: "bytes4" }], outputs: [{ type: "bool" }] }] as const;
const executionAbi = parseAbi([
  "function managedBundle(bytes32) view returns (bool)",
  "function executionVersion() view returns (uint256)",
  "function nativeValuePolicies(bytes32,address,bytes4) view returns (uint256 maxValue,uint8 amountArg)",
  "function executionManager() view returns (address)",
  "function bundles(bytes32) view returns (address policy,address reader,bytes32 policyCodeHash,bytes32 readerCodeHash,bytes32 policyHash,uint8 maxPositions,uint8 maxPending,uint32 maxAge)",
  "function dependencyValid(bytes32,address) view returns (bool)",
]);

function publicUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("integration-config-unavailable"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("integration-config-unavailable");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("integration-config-unavailable");
  return url.toString().replace(/\/$/, "");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function admitted(versionId: `0x${string}`, codeHash: string, blockNumber?: bigint): Promise<boolean> {
  const chain = monadClient();
  const block = { number: blockNumber ?? (await chain.getBlock({ blockTag: "finalized" })).number };
  const core = env.core as `0x${string}`;
  const [registry, health, exit, recoveryAdapter, actualChainId] = await Promise.all([
    chain.readContract({ address: core, abi: coreAbi, functionName: "integrationRegistry", blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "healthSource", blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "exitVerifierOfBundle", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "appRecoveryAdapterOfBundle", args: [versionId], blockNumber: block.number }),
    chain.getChainId(),
  ]);
  if (actualChainId !== env.monadChainId || !addressPattern.test(registry) || !addressPattern.test(health)
    || !addressPattern.test(exit) || !addressPattern.test(recoveryAdapter)
    || /^0x0{40}$/i.test(registry) || /^0x0{40}$/i.test(health)
    || /^0x0{40}$/i.test(exit) || /^0x0{40}$/i.test(recoveryAdapter)) return false;
  const [version, active, reader, readerConfig, recoveryCalls, exitHash, adapterHash, exitCode, adapterCode] = await Promise.all([
    chain.readContract({ address: registry, abi: registryAbi, functionName: "versions", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: registry, abi: registryAbi, functionName: "isActive", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: health, abi: healthAbi, functionName: "isReaderActive", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: health, abi: healthAbi, functionName: "readers", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: registry, abi: registryAbi, functionName: "recoveryCallCount", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "exitVerifierCodeHash", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "appRecoveryAdapterCodeHash", args: [versionId], blockNumber: block.number }),
    chain.getBytecode({ address: exit, blockNumber: block.number }),
    chain.getBytecode({ address: recoveryAdapter, blockNumber: block.number }),
  ]);
  const baseAdmitted = version[0].toLowerCase() === codeHash.toLowerCase() && version[1] && !version[2]
    && active && reader && recoveryCalls > 0n && !!exitCode && exitCode !== "0x"
    && !!adapterCode && adapterCode !== "0x" && keccak256(exitCode) === exitHash
    && keccak256(adapterCode) === adapterHash;
  if (!baseAdmitted || !readerConfig[2] || readerConfig[3] === 0n
    || !addressPattern.test(readerConfig[0]) || /^0x0{40}$/i.test(readerConfig[0])) return false;
  const appHealth = readerConfig[0];
  const [readerCode, readerCore, readerBundle, readerAdapter, appReader, appReaderHash] = await Promise.all([
    chain.getBytecode({ address: appHealth, blockNumber: block.number }),
    chain.readContract({ address: appHealth, abi: appHealthAbi, functionName: "core", blockNumber: block.number }),
    chain.readContract({ address: appHealth, abi: appHealthAbi, functionName: "bundleId", blockNumber: block.number }),
    chain.readContract({ address: appHealth, abi: appHealthAbi, functionName: "recoveryAdapter", blockNumber: block.number }),
    chain.readContract({ address: appHealth, abi: appHealthAbi, functionName: "appReader", blockNumber: block.number }),
    chain.readContract({ address: appHealth, abi: appHealthAbi, functionName: "appReaderCodeHash", blockNumber: block.number }),
  ]);
  if (!readerCode || readerCode === "0x" || keccak256(readerCode) !== readerConfig[4]
    || readerCore.toLowerCase() !== core.toLowerCase() || readerBundle.toLowerCase() !== versionId.toLowerCase()
    || readerAdapter.toLowerCase() !== recoveryAdapter.toLowerCase()
    || !addressPattern.test(appReader) || /^0x0{40}$/i.test(appReader)) return false;
  const appReaderCode = await chain.getBytecode({ address: appReader, blockNumber: block.number });
  if (!appReaderCode || appReaderCode === "0x" || keccak256(appReaderCode) !== appReaderHash) return false;
  const [managed, manager] = await Promise.all([
    chain.readContract({ address: core, abi: executionAbi, functionName: "managedBundle", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: core, abi: executionAbi, functionName: "executionManager", blockNumber: block.number }),
  ]);
  if (!managed || !addressPattern.test(manager) || /^0x0{40}$/i.test(manager)) return false;
  const execution = await chain.readContract({ address: manager, abi: executionAbi, functionName: "bundles",
    args: [versionId], blockNumber: block.number });
  const [policyCode, pinnedPolicy, pinnedReader] = await Promise.all([
    chain.getBytecode({ address: execution[0], blockNumber: block.number }),
    chain.readContract({ address: registry, abi: executionAbi, functionName: "dependencyValid", args: [versionId, execution[0]], blockNumber: block.number }),
    chain.readContract({ address: registry, abi: executionAbi, functionName: "dependencyValid", args: [versionId, appReader], blockNumber: block.number }),
  ]);
  return !!policyCode && policyCode !== "0x" && keccak256(policyCode) === execution[2]
    && execution[1].toLowerCase() === appReader.toLowerCase() && execution[3] === appReaderHash
    && execution[4] !== `0x${"0".repeat(64)}` && execution[5] > 0 && execution[5] <= 32
    && execution[6] <= 32 && execution[7] > 0 && pinnedPolicy && pinnedReader;
}

async function admittedActions(versionId: `0x${string}`, actions: CapabilityDefinition[], category?: string, settlementAsset?: string, blockNumber?: bigint): Promise<boolean> {
  if (actions.length === 0) return false;
  const parsedCategory = useCaseSchema.safeParse(category);
  if (!parsedCategory.success) return false;
  try { assertActionRoutes(actions); actions.forEach((action) => assertStandardDefinition(action, parsedCategory.data)); }
  catch { return false; }
  const chain = monadClient();
  const block = { number: blockNumber ?? (await chain.getBlock({ blockTag: "finalized" })).number };
  const registry = await chain.readContract({ address: env.core as `0x${string}`, abi: coreAbi,
    functionName: "integrationRegistry", blockNumber: block.number });
  if (await chain.readContract({ address: env.core as `0x${string}`, abi: executionAbi, functionName: "executionVersion", blockNumber: block.number }).catch(() => 0n) !== 2n) return false;
  for (const action of actions) {
    if (action.positionState && !await chain.readContract({ address: registry, abi: executionAbi, functionName: "dependencyValid",
      args: [versionId, action.positionState.target as `0x${string}`], blockNumber: block.number })) return false;
    if (action.orderSizing) for (const [asset, decimals] of [[action.orderSizing.baseAsset, action.orderSizing.baseDecimals],
      [action.orderSizing.quoteAsset, action.orderSizing.quoteDecimals]] as const) {
      if (/^0x0{40}$/i.test(asset)) { if (decimals !== 18) return false; continue; }
      if (!await chain.readContract({ address: registry, abi: executionAbi, functionName: "dependencyValid",
        args: [versionId, asset as `0x${string}`], blockNumber: block.number })
        || await chain.readContract({ address: asset as `0x${string}`, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals", blockNumber: block.number }) !== decimals) return false;
    }
  }
  const results = await Promise.all(actions.flatMap(capabilityCalls).map(async (action) => {
    const item = parseAbiItem(action.signature);
    if (item.type !== "function") return false;
    if (action.valuePath || action.valueFromBound || action.nativeValue !== undefined) {
      if (item.stateMutability !== "payable") return false;
      const policy = await chain.readContract({ address: registry, abi: executionAbi, functionName: "nativeValuePolicies",
        args: [versionId, action.target as `0x${string}`, toFunctionSelector(item)], blockNumber: block.number });
      if (policy[0] === 0n || action.nativeValue !== undefined && BigInt(action.nativeValue) > policy[0]
        || policy[1] !== 255 && (action.nativeValue !== undefined ? action.arguments[policy[1]]?.source !== "constant"
          || action.arguments[policy[1]]?.value !== action.nativeValue : action.valueFromBound ? action.arguments[policy[1]]?.source !== "price_bound"
        : action.arguments[policy[1]]?.source !== "input" || action.arguments[policy[1]]?.path !== action.valuePath)) return false;
    }
    return chain.readContract({ address: registry, abi: callAbi, functionName: "isCallAllowed",
      args: [versionId, action.target as `0x${string}`, toFunctionSelector(item)], blockNumber: block.number });
  }));
  return results.every(Boolean) && await admittedPrices(versionId, actions, block.number, category, settlementAsset);
}

export const integrationService = {
  async prepare(input: z.infer<typeof integrationSchema>, review?: { reviewer: `0x${string}`; forkReviewSignature?: `0x${string}` }) {
    const application = await applicationService.requireVerified(input.applicationId, undefined, true);
    const versionId = input.versionId as `0x${string}`;
    if (!addressPattern.test(input.settlementAsset) || /^0x0{40}$/i.test(input.settlementAsset)) {
      throw new Error("settlement-asset-unavailable");
    }
    if (!await admitted(versionId, input.codeHash) || !await admittedActions(versionId, input.actions, input.category, input.settlementAsset)) throw new Error("integration-not-admitted");
    const suite = assertSuiteEnvelope(versionId, input.codeHash as `0x${string}`, input.acceptance.suite,
      input.acceptance.evidenceHash, input.actions);
    await requireForkReview(suite, review?.forkReviewSignature, review?.reviewer);
    await validateIntegrationAcceptance(versionId, input.settlementAsset as `0x${string}`, input.actions, input.acceptance, input.codeHash as `0x${string}`);
    const sourcePins = await validateIntegrationSources(input.actions, input.verifiedSources);
    const appToken = `tbk_${randomBytes(32).toString("hex")}`;
    const doc = { versionId: input.versionId.toLowerCase(), codeHash: input.codeHash.toLowerCase(),
        applicationId: application.id, applicationOwner: application.owner, applicationOrigin: application.origin,
        category: input.category,
        settlementAsset: input.settlementAsset.toLowerCase(), actions: input.actions, sourcePins,
        acceptance: input.acceptance, accepted: true,
        review: { evidenceHash: input.acceptance.evidenceHash, mode: suite.mode, reviewer: review?.reviewer ?? null,
          forkReviewSignature: review?.forkReviewSignature ?? null, reviewedAt: new Date() },
        tokenHash: tokenHash(appToken), active: true, frozen: false };
    return { doc, appToken, versionId: input.versionId.toLowerCase() };
  },
  async approve(input: z.infer<typeof integrationSchema>) {
    const prepared = await this.prepare(input);
    try {
      await integrationRepo.create(prepared.doc);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new Error("integration-conflict", { cause: error });
      throw error;
    }
    return { versionId: prepared.versionId, appToken: prepared.appToken };
  },
  async resolve(appToken: string) {
    if (!tokenPattern.test(appToken)) throw new Error("integration-not-found");
    const row = await integrationRepo.byTokenHash(tokenHash(appToken));
    const useCase = useCaseSchema.safeParse(row?.["category"]);
    const actions = row?.["actions"] as CapabilityDefinition[] | undefined;
    const sourcePins = row?.["sourcePins"] as SourcePin[] | undefined;
    const actionTargets = Array.isArray(actions) ? new Set(actions.flatMap(capabilityDependencies).map((action) => action.target.toLowerCase())) : null;
    if (!row || !useCase.success || row["active"] !== true || row["accepted"] !== true
      || row["frozen"] === true || !Array.isArray(actions)
      || !integrationAcceptanceSchema.safeParse(row["acceptance"]).success
      || !Array.isArray(sourcePins) || sourcePins.length !== actionTargets?.size
      || new Set(sourcePins.map((pin) => pin.target.toLowerCase())).size !== sourcePins.length
      || sourcePins.some((pin) => !actionTargets?.has(pin.target.toLowerCase()))
      || !addressPattern.test(String(row["settlementAsset"])) || /^0x0{40}$/i.test(String(row["settlementAsset"]))) {
      throw new Error("integration-not-found");
    }
    if (!Number.isSafeInteger(env.monadChainId) || env.monadChainId <= 0
      || !addressPattern.test(env.core) || !addressPattern.test(env.accountFactory)
      || /^0x0{40}$/i.test(env.accountFactory)) {
      throw new Error("integration-config-unavailable");
    }
    const chain = monadClient();
    const block = await chain.getBlock({ blockTag: "finalized" });
    const checks = await Promise.all([
      admitted(String(row["versionId"]) as `0x${string}`, String(row["codeHash"]), block.number),
      admittedActions(String(row["versionId"]) as `0x${string}`, actions, String(row["category"]), String(row["settlementAsset"]), block.number),
      verifyIntegrationSourcePins(sourcePins, block.number),
    ]);
    if (!checks.every(Boolean)) throw new Error("integration-not-found");
    const packageDefinition = row["packageDefinition"] === undefined ? undefined : pluginDefinitionSchema.parse(row["packageDefinition"]);
    if (packageDefinition) {
      const packageHash = keccak256(stringToHex(canonicalEvidence(packageDefinition)));
      if (packageHash.toLowerCase() !== String(row["codeHash"]).toLowerCase()
        || keccak256(stringToHex(`termbook.integration.v1:${packageDefinition.chain_id}:${packageHash}`)).toLowerCase() !== String(row["versionId"]).toLowerCase()
        || packageDefinition.chain_id !== env.monadChainId || packageDefinition.use_case !== useCase.data
        || packageDefinition.settlement_asset.toLowerCase() !== String(row["settlementAsset"]).toLowerCase()
        || canonicalEvidence(packageDefinition.actions) !== canonicalEvidence(actions)) throw new Error("integration-not-found");
    }
    try {
      const acceptance = integrationAcceptanceSchema.parse(row["acceptance"]);
      const suite = assertSuiteEnvelope(String(row["versionId"]) as `0x${string}`, String(row["codeHash"]) as `0x${string}`,
        acceptance.suite, acceptance.evidenceHash, actions);
      const review = row["review"] as { evidenceHash?: string; mode?: string; reviewer?: `0x${string}`; forkReviewSignature?: `0x${string}` } | undefined;
      if (!review || review.evidenceHash?.toLowerCase() !== acceptance.evidenceHash.toLowerCase() || review.mode !== suite.mode) throw new Error("integration-review-missing");
      await requireForkReview(suite, review.forkReviewSignature, review.reviewer);
      await Promise.all([
        verifySuitePins(chain, suite, block.number),
        packageDefinition ? verify_definition(chain, packageDefinition, block.number) : Promise.resolve(),
      ]);
    } catch (cause) { throw new Error("integration-not-found", { cause }); }
    const settlementFactory = addressPattern.test(env.settlementFactory) && !/^0x0{40}$/i.test(env.settlementFactory)
      ? env.settlementFactory as `0x${string}` : undefined;
    const [coreCode, factoryCode, riskEngine, settlementCode] = await Promise.all([
      chain.getBytecode({ address: env.core as `0x${string}`, blockNumber: block.number }),
      chain.getBytecode({ address: env.accountFactory as `0x${string}`, blockNumber: block.number }),
      chain.readContract({ address: env.core as `0x${string}`, abi: coreAbi, functionName: "riskEngine", blockNumber: block.number }),
      settlementFactory ? chain.getBytecode({ address: settlementFactory, blockNumber: block.number }) : undefined,
    ]);
    if (!coreCode || coreCode === "0x" || !factoryCode || factoryCode === "0x"
      || settlementFactory && (!settlementCode || settlementCode === "0x")
      || !addressPattern.test(riskEngine) || /^0x0{40}$/i.test(riskEngine)) throw new Error("integration-config-unavailable");
    return { appToken, versionId: String(row["versionId"]), settlementAsset: String(row["settlementAsset"]), core: env.core,
      chainId: env.monadChainId, rpcUrl: publicUrl(env.publicRpcUrl), apiBase: publicUrl(env.publicApiBase),
      accountFactory: env.accountFactory, riskEngine, settlementFactory, use_case: useCase.data, actions,
      ...(packageDefinition ? { integration_definition: packageDefinition } : {}) };
  },
  async list() {
    return integrationRepo.list();
  },
};
