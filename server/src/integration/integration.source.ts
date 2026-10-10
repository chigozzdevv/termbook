import { createHash } from "node:crypto";
import { keccak256, parseAbiItem, toFunctionSelector,
  type AbiFunction, type Address, type Hex } from "viem";
import { capabilityDependencies, proxyImplementationSlots, proxyBeaconSlot, type CapabilityDefinition } from "@termbook/schema";
import { readProxyImplementation } from "../chain/proxy.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";

const sourceApi = "https://sourcify.dev/server/v2/contract";
const maxResponseBytes = 3_000_000;
export const implementationSlot = proxyImplementationSlots[0];
export const beaconSlot = proxyBeaconSlot;
const zero = "0x0000000000000000000000000000000000000000";
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const wordPattern = /^0x[0-9a-fA-F]{64}$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("integration-source-invalid");
  return value as Record<string, unknown>;
}

function metadataMatch(runtime: Record<string, unknown>): boolean {
  const compiled = runtime["recompiledBytecode"], actual = runtime["onchainBytecode"];
  const changes = runtime["transformations"];
  if (typeof compiled !== "string" || typeof actual !== "string" || !/^0x(?:[a-fA-F0-9]{2})+$/.test(compiled)
    || !/^0x(?:[a-fA-F0-9]{2})+$/.test(actual) || compiled.length !== actual.length
    || !Array.isArray(changes) || changes.length === 0 || changes.length > 128) return false;
  const ranges: { start: number; length: number }[] = [];
  let metadata = false;
  for (const input of changes) {
    const change = record(input);
    if (change["type"] !== "replace" || typeof change["id"] !== "string"
      || !Number.isSafeInteger(change["offset"]) || Number(change["offset"]) < 1) return false;
    const offset = Number(change["offset"]);
    let length: number;
    if (change["reason"] === "cborAuxdata") {
      const auxiliary = record(record(runtime["cborAuxdata"])[change["id"]]);
      const value = auxiliary["value"];
      if (auxiliary["offset"] !== offset || typeof value !== "string" || !/^0xa[1-9](?:[a-fA-F0-9]{2})+$/.test(value)) return false;
      length = (value.length - 2) / 2;
      const live = actual.slice(2 + offset * 2, 2 + (offset + length) * 2);
      if (offset * 2 + value.length > compiled.length
        || compiled.slice(2 + offset * 2, 2 + (offset + length) * 2).toLowerCase() !== value.slice(2).toLowerCase()
        || !/^a[1-9](?:[a-fA-F0-9]{2})+$/.test(live)
        || parseInt(value.slice(-4), 16) + 2 !== length || parseInt(live.slice(-4), 16) + 2 !== length) return false;
      metadata = true;
    } else if (change["reason"] === "immutable") {
      const references = record(runtime["immutableReferences"])[change["id"]];
      if (!Array.isArray(references) || !references.some((input) => {
        const reference = record(input);
        return reference["start"] === offset && reference["length"] === 32;
      })) return false;
      length = 32;
    } else return false;
    if (2 + (offset + length) * 2 > compiled.length) return false;
    ranges.push({ start: offset, length });
  }
  ranges.sort((left, right) => left.start - right.start);
  if (!metadata || ranges.some((range, index) => index > 0 && range.start < ranges[index - 1]!.start + ranges[index - 1]!.length)) return false;
  const normalize = (code: string) => {
    let result = code.toLowerCase();
    for (const range of ranges) result = result.slice(0, 2 + range.start * 2) + "0".repeat(range.length * 2) + result.slice(2 + (range.start + range.length) * 2);
    return result;
  };
  // Compiler-declared metadata and immutables may differ; every other byte must match.
  return normalize(compiled) === normalize(actual);
}

function selector(signature: string): Hex {
  const item = parseAbiItem(signature);
  if (item.type !== "function" || !["nonpayable", "payable"].includes(item.stateMutability)) {
    throw new Error("integration-source-selector-mismatch");
  }
  return toFunctionSelector(item);
}

async function limitedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body) throw new Error("integration-source-unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxResponseBytes) {
        await reader.cancel();
        throw new Error("integration-source-too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    throw new Error("integration-source-invalid");
  }
}

export async function importVerifiedSource(
  chainId: number, address: Address, code: Hex, selector: Hex | null, payable?: boolean,
) {
  const url = `${sourceApi}/${chainId}/${address}?fields=runtimeBytecode.onchainBytecode,runtimeBytecode.recompiledBytecode,runtimeBytecode.cborAuxdata,runtimeBytecode.transformations,runtimeBytecode.immutableReferences,abi,sources,compilation`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" })
    .catch(() => null);
  if (!response) throw new Error("integration-source-unavailable");
  const result = await limitedJson(response);
  const runtime = record(result["runtimeBytecode"]);
  const compilation = record(result["compilation"]);
  const sources = record(result["sources"]);
  const abi = result["abi"];
  if (!(result["runtimeMatch"] === "exact_match" || result["runtimeMatch"] === "match" && metadataMatch(runtime)) || result["chainId"] !== String(chainId)
    || String(result["address"]).toLowerCase() !== address.toLowerCase()
    || String(runtime["onchainBytecode"]).toLowerCase() !== code.toLowerCase()
    || !Array.isArray(abi) || abi.length > 2048
    || Object.keys(sources).length === 0 || Object.keys(sources).length > 256
    || typeof compilation["compilerVersion"] !== "string"
    || typeof compilation["fullyQualifiedName"] !== "string"
    || typeof result["matchId"] !== "string") throw new Error("integration-source-unverified");
  if (selector !== null && !abi.some((entry) => {
    try {
      const item = record(entry) as AbiFunction;
      return item.type === "function" && ["nonpayable", "payable"].includes(item.stateMutability)
        && toFunctionSelector(item) === selector && (payable !== true || item.stateMutability === "payable");
    } catch {
      return false;
    }
  })) throw new Error("integration-source-selector-mismatch");
  const files = Object.entries(sources).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const contents = files.map(([path, value]) => {
    const content = record(value)["content"];
    if (!path || path.length > 512 || typeof content !== "string") throw new Error("integration-source-invalid");
    return [path, content];
  });
  const sourceHash = `0x${createHash("sha256").update(JSON.stringify(contents)).digest("hex")}`;
  return { address, matchId: result["matchId"], runtimeMatch: result["runtimeMatch"], compilerVersion: compilation["compilerVersion"],
    contract: compilation["fullyQualifiedName"], sourceHash, files: files.map(([path]) => path), url };
}

export type SourceEvidence = { target: string; sourceHash: string;
  implementation?: string; implementationSourceHash?: string };
export type SourcePin = { target: Address; codeHash: Hex; sourceHash: Hex;
  implementation: Address | null; implementationSlot: Hex | null;
  implementationCodeHash: Hex | null; implementationSourceHash: Hex | null };

export async function validateIntegrationSources(
  actions: CapabilityDefinition[], evidence: SourceEvidence[],
): Promise<SourcePin[]> {
  const chain = monadClient();
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (await chain.getChainId() !== env.monadChainId) throw new Error("integration-chain-mismatch");
  const byTarget = new Map(evidence.map((item) => [item.target.toLowerCase(), item]));
  const calls = actions.flatMap(capabilityDependencies);
  const targets = new Set(calls.map((action) => action.target.toLowerCase()));
  if (byTarget.size !== evidence.length || targets.size !== evidence.length
    || [...byTarget.keys()].some((target) => !targets.has(target))) {
    throw new Error("integration-source-evidence-incomplete");
  }
  const pins: SourcePin[] = [];
  for (const targetKey of targets) {
    const target = targetKey as Address;
    const reviewed = byTarget.get(targetKey)!;
    const [code, proxy] = await Promise.all([
      chain.getBytecode({ address: target, blockNumber: finalized.number }),
      readProxyImplementation(chain, target, finalized.number),
    ]);
    if (!code || code === "0x") {
      throw new Error("integration-source-proxy-invalid");
    }
    const implementation = proxy?.implementation ?? null;
    if (implementation && (!reviewed.implementation
      || reviewed.implementation.toLowerCase() !== implementation.toLowerCase()
      || !reviewed.implementationSourceHash)
      || !implementation && (reviewed.implementation || reviewed.implementationSourceHash)
      || !wordPattern.test(reviewed.sourceHash)) throw new Error("integration-source-evidence-invalid");
    const targetActions = calls.filter((action) => action.target.toLowerCase() === targetKey);
    const source = await importVerifiedSource(env.monadChainId, target, code,
      implementation ? null : selector(targetActions[0]!.signature), !!(targetActions[0]!.valuePath || targetActions[0]!.valueFromBound));
    if (source.sourceHash.toLowerCase() !== reviewed.sourceHash.toLowerCase()) {
      throw new Error("integration-source-evidence-invalid");
    }
    let implementationCodeHash: Hex | null = null;
    let implementationSourceHash: Hex | null = null;
    let implementationCode: Hex | undefined;
    if (implementation) {
      implementationCode = await chain.getBytecode({ address: implementation, blockNumber: finalized.number });
      if (!implementationCode || implementationCode === "0x") throw new Error("integration-source-proxy-invalid");
      const imported = await importVerifiedSource(env.monadChainId, implementation, implementationCode,
        selector(targetActions[0]!.signature), !!(targetActions[0]!.valuePath || targetActions[0]!.valueFromBound));
      if (imported.sourceHash.toLowerCase() !== reviewed.implementationSourceHash!.toLowerCase()) {
        throw new Error("integration-source-evidence-invalid");
      }
      implementationCodeHash = keccak256(implementationCode);
      implementationSourceHash = imported.sourceHash as Hex;
    }
    for (const action of targetActions.slice(1)) {
      await importVerifiedSource(env.monadChainId, implementation ?? target,
        implementationCode ?? code, selector(action.signature), !!(action.valuePath || action.valueFromBound));
    }
    pins.push({ target, codeHash: keccak256(code), sourceHash: source.sourceHash as Hex,
      implementation, implementationSlot: proxy?.slot ?? null, implementationCodeHash, implementationSourceHash });
  }
  return pins;
}

export async function verifyIntegrationSourcePins(pins: SourcePin[]): Promise<boolean> {
  if (!pins.length || pins.length > 32) return false;
  const chain = monadClient();
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (await chain.getChainId() !== env.monadChainId) return false;
  for (const pin of pins) {
    if (!addressPattern.test(pin.target) || !wordPattern.test(pin.codeHash)
      || !wordPattern.test(pin.sourceHash) || (pin.implementation !== null
      && (!addressPattern.test(pin.implementation) || !wordPattern.test(pin.implementationCodeHash ?? "")))
      || (pin.implementation === null && pin.implementationCodeHash !== null)) return false;
    const [code, proxy] = await Promise.all([
      chain.getBytecode({ address: pin.target, blockNumber: finalized.number }),
      readProxyImplementation(chain, pin.target, finalized.number),
    ]);
    if (!code || keccak256(code) !== pin.codeHash) return false;
    if ((proxy?.implementation ?? zero).toLowerCase() !== (pin.implementation ?? zero).toLowerCase()
      || (proxy?.slot ?? null) !== pin.implementationSlot) return false;
    if (pin.implementation) {
      const implementationCode = await chain.getBytecode({ address: pin.implementation, blockNumber: finalized.number });
      if (!implementationCode || keccak256(implementationCode) !== pin.implementationCodeHash) return false;
    }
  }
  return true;
}
