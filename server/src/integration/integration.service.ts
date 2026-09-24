import { createHash, randomBytes } from "node:crypto";
import { keccak256, parseAbiItem, toFunctionSelector } from "viem";
import type { CapabilityDefinition } from "@termbook/schema";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { integrationRepo } from "./integration.repo.js";

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
] as const;
const callAbi = [{ type: "function", name: "isCallAllowed", stateMutability: "view",
  inputs: [{ type: "bytes32" }, { type: "address" }, { type: "bytes4" }], outputs: [{ type: "bool" }] }] as const;

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

async function admitted(versionId: `0x${string}`, codeHash: string): Promise<boolean> {
  const chain = monadClient();
  const block = await chain.getBlock({ blockTag: "finalized" });
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
  const [version, active, reader, recoveryCalls, exitHash, adapterHash, exitCode, adapterCode] = await Promise.all([
    chain.readContract({ address: registry, abi: registryAbi, functionName: "versions", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: registry, abi: registryAbi, functionName: "isActive", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: health, abi: healthAbi, functionName: "isReaderActive", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: registry, abi: registryAbi, functionName: "recoveryCallCount", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "exitVerifierCodeHash", args: [versionId], blockNumber: block.number }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "appRecoveryAdapterCodeHash", args: [versionId], blockNumber: block.number }),
    chain.getBytecode({ address: exit, blockNumber: block.number }),
    chain.getBytecode({ address: recoveryAdapter, blockNumber: block.number }),
  ]);
  return version[0].toLowerCase() === codeHash.toLowerCase() && version[1] && !version[2]
    && active && reader && recoveryCalls > 0n && !!exitCode && exitCode !== "0x"
    && !!adapterCode && adapterCode !== "0x" && keccak256(exitCode) === exitHash
    && keccak256(adapterCode) === adapterHash;
}

async function admittedActions(versionId: `0x${string}`, actions: CapabilityDefinition[]): Promise<boolean> {
  if (actions.length === 0) return false;
  const chain = monadClient();
  const block = await chain.getBlock({ blockTag: "finalized" });
  const registry = await chain.readContract({ address: env.core as `0x${string}`, abi: coreAbi,
    functionName: "integrationRegistry", blockNumber: block.number });
  const results = await Promise.all(actions.map(async (action) => {
    const item = parseAbiItem(action.signature);
    if (item.type !== "function") return false;
    return chain.readContract({ address: registry, abi: callAbi, functionName: "isCallAllowed",
      args: [versionId, action.target as `0x${string}`, toFunctionSelector(item)], blockNumber: block.number });
  }));
  return results.every(Boolean);
}

export const integrationService = {
  async approve(input: { versionId: string; codeHash: string; settlementAsset: string; actions: CapabilityDefinition[] }) {
    const versionId = input.versionId as `0x${string}`;
    if (!addressPattern.test(input.settlementAsset) || /^0x0{40}$/i.test(input.settlementAsset)) {
      throw new Error("settlement-asset-unavailable");
    }
    if (!await admitted(versionId, input.codeHash) || !await admittedActions(versionId, input.actions)) throw new Error("integration-not-admitted");
    const appToken = `tbk_${randomBytes(32).toString("hex")}`;
    try {
      await integrationRepo.create({ versionId: input.versionId.toLowerCase(), codeHash: input.codeHash.toLowerCase(),
        settlementAsset: input.settlementAsset.toLowerCase(), actions: input.actions,
        tokenHash: tokenHash(appToken), active: true, frozen: false });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new Error("integration-conflict", { cause: error });
      throw error;
    }
    return { versionId: input.versionId.toLowerCase(), appToken };
  },
  async resolve(appToken: string) {
    if (!tokenPattern.test(appToken)) throw new Error("integration-not-found");
    const row = await integrationRepo.byTokenHash(tokenHash(appToken));
    const actions = row?.["actions"] as CapabilityDefinition[] | undefined;
    if (!row || row["active"] !== true || row["frozen"] === true || !Array.isArray(actions)
      || !addressPattern.test(String(row["settlementAsset"])) || /^0x0{40}$/i.test(String(row["settlementAsset"]))
      || !await admitted(String(row["versionId"]) as `0x${string}`, String(row["codeHash"]))
      || !await admittedActions(String(row["versionId"]) as `0x${string}`, actions)) {
      throw new Error("integration-not-found");
    }
    if (!Number.isSafeInteger(env.monadChainId) || env.monadChainId <= 0
      || !addressPattern.test(env.core) || !addressPattern.test(env.accountFactory)
      || /^0x0{40}$/i.test(env.accountFactory)) {
      throw new Error("integration-config-unavailable");
    }
    const chain = monadClient();
    const block = await chain.getBlock({ blockTag: "finalized" });
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
      accountFactory: env.accountFactory, riskEngine, settlementFactory, actions };
  },
  async list() {
    return integrationRepo.list();
  },
};
