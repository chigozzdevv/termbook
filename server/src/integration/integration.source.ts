import { createHash } from "node:crypto";
import { keccak256, parseAbiItem, stringToHex, toFunctionSelector, toHex,
  type AbiFunction, type Address, type Hex } from "viem";
import { capabilityCalls, type CapabilityDefinition } from "@termbook/schema";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";

const sourceApi = "https://sourcify.dev/server/v2/contract";
const maxResponseBytes = 3_000_000;
export const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const beaconSlot = toHex(BigInt(keccak256(stringToHex("eip1967.proxy.beacon"))) - 1n, { size: 32 });
const zero = "0x0000000000000000000000000000000000000000";
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const wordPattern = /^0x[0-9a-fA-F]{64}$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("integration-source-invalid");
  return value as Record<string, unknown>;
}

function selector(signature: string): Hex {
  const item = parseAbiItem(signature);
  if (item.type !== "function" || item.stateMutability !== "nonpayable") {
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
  chainId: number, address: Address, code: Hex, selector: Hex | null,
) {
  const url = `${sourceApi}/${chainId}/${address}?fields=runtimeBytecode.onchainBytecode,abi,sources,compilation`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" })
    .catch(() => null);
  if (!response) throw new Error("integration-source-unavailable");
  const result = await limitedJson(response);
  const runtime = record(result["runtimeBytecode"]);
  const compilation = record(result["compilation"]);
  const sources = record(result["sources"]);
  const abi = result["abi"];
  if (result["runtimeMatch"] !== "exact_match" || result["chainId"] !== String(chainId)
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
      return item.type === "function" && item.stateMutability === "nonpayable"
        && toFunctionSelector(item) === selector;
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
  return { address, matchId: result["matchId"], compilerVersion: compilation["compilerVersion"],
    contract: compilation["fullyQualifiedName"], sourceHash, files: files.map(([path]) => path), url };
}

export type SourceEvidence = { target: string; sourceHash: string;
  implementation?: string; implementationSourceHash?: string };
export type SourcePin = { target: Address; codeHash: Hex; sourceHash: Hex;
  implementation: Address | null; implementationCodeHash: Hex | null; implementationSourceHash: Hex | null };

export async function validateIntegrationSources(
  actions: CapabilityDefinition[], evidence: SourceEvidence[],
): Promise<SourcePin[]> {
  const chain = monadClient();
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (await chain.getChainId() !== env.monadChainId) throw new Error("integration-chain-mismatch");
  const byTarget = new Map(evidence.map((item) => [item.target.toLowerCase(), item]));
  const calls = actions.flatMap(capabilityCalls);
  const targets = new Set(calls.map((action) => action.target.toLowerCase()));
  if (byTarget.size !== evidence.length || targets.size !== evidence.length
    || [...byTarget.keys()].some((target) => !targets.has(target))) {
    throw new Error("integration-source-evidence-incomplete");
  }
  const pins: SourcePin[] = [];
  for (const targetKey of targets) {
    const target = targetKey as Address;
    const reviewed = byTarget.get(targetKey)!;
    const [code, implementationWord, beaconWord] = await Promise.all([
      chain.getBytecode({ address: target, blockNumber: finalized.number }),
      chain.getStorageAt({ address: target, slot: implementationSlot, blockNumber: finalized.number }),
      chain.getStorageAt({ address: target, slot: beaconSlot, blockNumber: finalized.number }),
    ]);
    if (!code || code === "0x" || beaconWord && BigInt(beaconWord) !== 0n
      || implementationWord && !/^0x0{24}[0-9a-fA-F]{40}$/.test(implementationWord)) {
      throw new Error("integration-source-proxy-invalid");
    }
    const implementation = implementationWord && BigInt(implementationWord) !== 0n
      ? `0x${implementationWord.slice(-40)}` as Address : null;
    if (implementation && (!reviewed.implementation
      || reviewed.implementation.toLowerCase() !== implementation.toLowerCase()
      || !reviewed.implementationSourceHash)
      || !implementation && (reviewed.implementation || reviewed.implementationSourceHash)
      || !wordPattern.test(reviewed.sourceHash)) throw new Error("integration-source-evidence-invalid");
    const targetActions = calls.filter((action) => action.target.toLowerCase() === targetKey);
    const source = await importVerifiedSource(env.monadChainId, target, code,
      implementation ? null : selector(targetActions[0]!.signature));
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
        selector(targetActions[0]!.signature));
      if (imported.sourceHash.toLowerCase() !== reviewed.implementationSourceHash!.toLowerCase()) {
        throw new Error("integration-source-evidence-invalid");
      }
      implementationCodeHash = keccak256(implementationCode);
      implementationSourceHash = imported.sourceHash as Hex;
    }
    for (const action of targetActions.slice(1)) {
      await importVerifiedSource(env.monadChainId, implementation ?? target,
        implementationCode ?? code, selector(action.signature));
    }
    pins.push({ target, codeHash: keccak256(code), sourceHash: source.sourceHash as Hex,
      implementation, implementationCodeHash, implementationSourceHash });
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
    const [code, implementationWord, beaconWord] = await Promise.all([
      chain.getBytecode({ address: pin.target, blockNumber: finalized.number }),
      chain.getStorageAt({ address: pin.target, slot: implementationSlot, blockNumber: finalized.number }),
      chain.getStorageAt({ address: pin.target, slot: beaconSlot, blockNumber: finalized.number }),
    ]);
    if (!code || keccak256(code) !== pin.codeHash || beaconWord && BigInt(beaconWord) !== 0n) return false;
    const implementation = implementationWord && BigInt(implementationWord) !== 0n
      ? `0x${implementationWord.slice(-40)}` : zero;
    if (implementation.toLowerCase() !== (pin.implementation ?? zero).toLowerCase()) return false;
    if (pin.implementation) {
      const implementationCode = await chain.getBytecode({ address: pin.implementation, blockNumber: finalized.number });
      if (!implementationCode || keccak256(implementationCode) !== pin.implementationCodeHash) return false;
    }
  }
  return true;
}
