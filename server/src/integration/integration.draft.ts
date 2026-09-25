import {
  decodeFunctionData, keccak256, parseAbiItem, toFunctionSelector,
  type Address, type Hex,
} from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { coreActionAbi } from "./integration.abi.js";
import { beaconSlot, implementationSlot, importVerifiedSource } from "./integration.source.js";
import type { integrationDraftSchema } from "./integration.schema.js";
import type { z } from "zod";

type DraftInput = z.infer<typeof integrationDraftSchema>;
const zero = "0x0000000000000000000000000000000000000000";

function equal(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export async function inspectIntegrationDraft(input: DraftInput) {
  const chain = monadClient();
  const finalized = await chain.getBlock({ blockTag: "finalized" });
  if (await chain.getChainId() !== env.monadChainId) throw new Error("integration-chain-mismatch");
  const core = env.core as Address;
  const entries = [];
  for (const entry of input.entries) {
    const target = entry.target as Address;
    let signature;
    try {
      signature = parseAbiItem(entry.signature);
    } catch {
      throw new Error("integration-draft-signature-invalid");
    }
    if (signature.type !== "function" || signature.stateMutability !== "nonpayable") {
      throw new Error("integration-draft-signature-invalid");
    }
    const [code, implementationWord, beaconWord, receipt, transaction] = await Promise.all([
      chain.getBytecode({ address: target, blockNumber: finalized.number }),
      chain.getStorageAt({ address: target, slot: implementationSlot, blockNumber: finalized.number }),
      chain.getStorageAt({ address: target, slot: beaconSlot, blockNumber: finalized.number }),
      chain.getTransactionReceipt({ hash: entry.txHash as Hex }),
      chain.getTransaction({ hash: entry.txHash as Hex }),
    ]);
    if (!code || code === "0x" || !equal(keccak256(code), entry.codeHash)) {
      throw new Error("integration-draft-code-mismatch");
    }
    if (beaconWord && BigInt(beaconWord) !== 0n || implementationWord
      && !/^0x0{24}[0-9a-fA-F]{40}$/.test(implementationWord)) {
      throw new Error("integration-draft-proxy-mismatch");
    }
    const implementation = implementationWord
      ? `0x${implementationWord.slice(-40)}` as Address : zero as Address;
    if (equal(implementation, zero) !== (entry.implementationCodeHash === undefined)) {
      throw new Error("integration-draft-proxy-mismatch");
    }
    let implementationCode: Hex | undefined;
    if (!equal(implementation, zero)) {
      implementationCode = await chain.getBytecode({ address: implementation, blockNumber: finalized.number });
      if (!implementationCode || implementationCode === "0x"
        || !equal(keccak256(implementationCode), entry.implementationCodeHash!)) {
        throw new Error("integration-draft-proxy-mismatch");
      }
    }
    if (receipt.status !== "success" || receipt.blockNumber > finalized.number
      || !equal(receipt.transactionHash, entry.txHash)
      || !equal(receipt.to ?? zero, core) || !equal(transaction.hash, entry.txHash)
      || !equal(transaction.to ?? zero, core) || !equal(transaction.blockHash ?? "", receipt.blockHash)
      || receipt.logs.length > 256 || transaction.input.length > 200_002
      || receipt.logs.reduce((size, log) => size + log.data.length
        + log.topics.reduce((total, topic) => total + topic.length, 0), 0) > 500_000) {
      throw new Error("integration-draft-reference-invalid");
    }
    const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
    if (!equal(block.hash, receipt.blockHash)) throw new Error("integration-draft-reference-invalid");
    let decoded;
    try {
      decoded = decodeFunctionData({ abi: coreActionAbi, data: transaction.input });
    } catch {
      throw new Error("integration-draft-reference-invalid");
    }
    const [creditId, calledTarget, data] = decoded.args;
    if (!equal(calledTarget, target) || !equal(data.slice(0, 10), toFunctionSelector(signature))) {
      throw new Error("integration-draft-reference-invalid");
    }
    const selector = toFunctionSelector(signature);
    const [source, implementationSource] = await Promise.all([
      importVerifiedSource(env.monadChainId, target, code, equal(implementation, zero) ? selector : null),
      equal(implementation, zero) ? Promise.resolve(null) : importVerifiedSource(env.monadChainId,
        implementation, implementationCode!, selector),
    ]);
    entries.push({
      target, codeHash: entry.codeHash.toLowerCase(),
      implementation: equal(implementation, zero) ? null : implementation,
      implementationCodeHash: entry.implementationCodeHash?.toLowerCase() ?? null,
      signature: entry.signature, selector, source, implementationSource,
      parameters: signature.inputs.map((param) => ({ name: param.name, type: param.type })),
      reference: { txHash: entry.txHash.toLowerCase(), blockNumber: receipt.blockNumber.toString(),
        creditId, functionName: decoded.functionName, callData: data,
        logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })) },
    });
  }
  return { chainId: env.monadChainId, finalizedBlock: finalized.number.toString(), entries };
}
