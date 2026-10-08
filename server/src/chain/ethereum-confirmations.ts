import { encodeAbiParameters, keccak256, parseAbi, stringToHex, type Address, type Hex, type PublicClient } from "viem";
import { termbookCoreAbi, verifierRegistryAbi } from "@termbook/bindings";
import { monadClient } from "./monad.client.js";
import { env } from "../config/env.js";

const abi = parseAbi(["function lightClient() view returns(address)", "function consensusVersion() view returns(uint256)",
  "function publisher() view returns(address)", "function confirmationDepth() view returns(uint16)",
  "function confirmationPolicyHash() view returns(bytes32)"]);
export function sepoliaConfirmationHash(publisher: Address, depth: number): Hex {
  const config = `0x01c8${depth.toString(16).padStart(4, "0")}${"00".repeat(28)}` as Hex;
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }],
    [keccak256(stringToHex("Termbook Wormhole Sepolia confirmations v1")), 11155111n, publisher, config]));
}
export async function ethereumConfirmationPolicy(verifier: Address) {
  if (env.monadChainId === 143) return { depth: 0, hash: `0x${"00".repeat(32)}` as Hex, consistency: 0 as const };
  const client = monadClient();
  const at = (await client.getBlock({ blockTag: "finalized" })).number;
  const read = (address: Address, functionName: "lightClient" | "consensusVersion" | "publisher" | "confirmationDepth" | "confirmationPolicyHash") =>
    client.readContract({ address, abi, functionName, blockNumber: at });
  const version = await read(verifier, "consensusVersion");
  if (version === 1n) return { depth: 0, hash: `0x${"00".repeat(32)}` as Hex, consistency: 0 as const };
  if (env.monadChainId !== 10143 || version !== 2n) throw new Error("ethereum-confirmation-policy-invalid");
  const [lightClient, publisher] = await Promise.all([read(verifier, "lightClient"), read(verifier, "publisher")]);
  const [depth, hash] = await Promise.all([read(lightClient as Address, "confirmationDepth"), read(lightClient as Address, "confirmationPolicyHash")]);
  if (typeof depth !== "number" || depth < 5 || depth > 64 || hash !== sepoliaConfirmationHash(publisher as Address, depth)) {
    throw new Error("ethereum-confirmation-policy-invalid");
  }
  return { depth, hash: hash as Hex, consistency: 203 as const };
}
export async function ethereumCreditConfirmationPolicy(creditId: Hex) {
  const client = monadClient(), at = (await client.getBlock({ blockTag: "finalized" })).number;
  const core = env.core as Address;
  const credit = await client.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails", args: [creditId], blockNumber: at });
  const registry = await client.readContract({ address: core, abi: termbookCoreAbi, functionName: "verifierRegistry", blockNumber: at });
  const sourceChain = await client.readContract({ address: core, abi: termbookCoreAbi, functionName: "collateralSourceChainOf", args: [creditId], blockNumber: at });
  const [verifier, version, active,, codeHash] = await client.readContract({ address: registry, abi: verifierRegistryAbi,
    functionName: "verifiers", args: [sourceChain], blockNumber: at });
  const code = await client.getCode({ address: verifier, blockNumber: at });
  if (!active || version !== credit.verifierVersion || codeHash !== credit.verifierCodeHash || !code || keccak256(code) !== codeHash) {
    throw new Error("ethereum-confirmation-verifier-mismatch");
  }
  return ethereumConfirmationPolicy(verifier);
}
export async function ethereumConfirmedBlock(client: PublicClient, depth: number) {
  if (depth === 0) return client.getBlock({ blockTag: "finalized" });
  if (!Number.isInteger(depth) || depth < 5 || depth > 64 || await client.getChainId() !== 11155111) throw new Error("ethereum-confirmation-policy-invalid");
  const latest = await client.getBlock({ blockTag: "latest" });
  if (latest.number < BigInt(depth)) throw new Error("ethereum-confirmations-unavailable");
  return client.getBlock({ blockNumber: latest.number - BigInt(depth) });
}
