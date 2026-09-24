import { createPublicClient, http, parseAbi, parseAbiItem, toFunctionSelector } from "viem";
import { capabilityDefinitionSchema } from "@termbook/schema";
import type { ClientConfig, ResolvedClientConfig } from "../types/client.types.js";

const tokenPattern = /^tbk_[a-f0-9]{64}$/;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const wordPattern = /^0x[a-fA-F0-9]{64}$/;
const coreAbi = parseAbi([
  "function integrationRegistry() view returns (address)",
  "function riskEngine() view returns (address)",
]);
const registryAbi = parseAbi([
  "function isActive(bytes32) view returns (bool)",
  "function isCallAllowed(bytes32,address,bytes4) view returns (bool)",
]);

function publicUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("sdk-config-invalid");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("sdk-config-invalid"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("sdk-config-invalid");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("sdk-config-invalid");
  return url.toString().replace(/\/$/, "");
}

export async function resolveClientConfig(input: ClientConfig): Promise<ResolvedClientConfig> {
  const appToken = input.appToken ?? input.app_token;
  if (!appToken || !tokenPattern.test(appToken)) throw new Error("app-token-invalid");
  const apiBase = publicUrl(process.env.TERMBOOK_PUBLIC_API_BASE);
  const response = await fetch(`${apiBase}/integrations/config?app_token=${encodeURIComponent(appToken)}`, {
    headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) throw new Error("app-config-unavailable");
  const data = await response.json() as Record<string, unknown>;
  if (data["appToken"] !== appToken || publicUrl(data["apiBase"]) !== apiBase
    || !addressPattern.test(String(data["core"])) || /^0x0{40}$/i.test(String(data["core"]))
    || !addressPattern.test(String(data["accountFactory"])) || /^0x0{40}$/i.test(String(data["accountFactory"]))
    || !wordPattern.test(String(data["versionId"]))
    || !Number.isSafeInteger(data["chainId"]) || Number(data["chainId"]) <= 0) {
    throw new Error("sdk-config-invalid");
  }
  const rpcUrl = publicUrl(data["rpcUrl"]);
  const core = data["core"] as `0x${string}`;
  const versionId = data["versionId"] as `0x${string}`;
  if (!Array.isArray(data["actions"]) || data["actions"].length === 0 || data["actions"].length > 32) throw new Error("sdk-config-invalid");
  const actions = data["actions"].map((action) => capabilityDefinitionSchema.parse(action));
  if (new Set(actions.map((action) => action.capability)).size !== actions.length) throw new Error("sdk-config-invalid");
  const accountFactory = data["accountFactory"] as `0x${string}`;
  const riskEngine = data["riskEngine"];
  const settlementFactory = data["settlementFactory"];
  if (!addressPattern.test(String(riskEngine)) || /^0x0{40}$/i.test(String(riskEngine))
    || settlementFactory !== undefined && (!addressPattern.test(String(settlementFactory)) || /^0x0{40}$/i.test(String(settlementFactory)))) {
    throw new Error("sdk-config-invalid");
  }
  const chainId = data["chainId"] as number;
  const chain = createPublicClient({ transport: http(rpcUrl) });
  const [actualChainId, coreCode, factoryCode, registry, configuredRiskEngine] = await Promise.all([
    chain.getChainId(), chain.getBytecode({ address: core, blockTag: "finalized" }), chain.getBytecode({ address: accountFactory, blockTag: "finalized" }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "integrationRegistry", blockTag: "finalized" }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "riskEngine", blockTag: "finalized" }),
  ]);
  if (actualChainId !== chainId || !coreCode || coreCode === "0x" || !factoryCode || factoryCode === "0x"
    || configuredRiskEngine.toLowerCase() !== String(riskEngine).toLowerCase()
    || !addressPattern.test(registry)
    || /^0x0{40}$/i.test(registry)) throw new Error("sdk-config-invalid");
  const [active, allowed] = await Promise.all([
    chain.readContract({ address: registry, abi: registryAbi, functionName: "isActive", args: [versionId], blockTag: "finalized" }),
    Promise.all(actions.map(async (action) => {
      const item = parseAbiItem(action.signature);
      if (item.type !== "function" || item.stateMutability !== "nonpayable" || item.inputs.length !== action.arguments.length) return false;
      return chain.readContract({ address: registry, abi: registryAbi, functionName: "isCallAllowed",
        args: [versionId, action.target as `0x${string}`, toFunctionSelector(item)], blockTag: "finalized" });
    })),
  ]);
  if (!active || !allowed.every(Boolean) || input.wallet.getChainId && await input.wallet.getChainId() !== chainId) throw new Error("sdk-config-invalid");
  return { appToken, versionId, wallet: input.wallet, core, rpcUrl, chainId, apiBase, accountFactory,
    riskEngine: riskEngine as `0x${string}`, settlementFactory: settlementFactory as `0x${string}` | undefined, actions };
}
