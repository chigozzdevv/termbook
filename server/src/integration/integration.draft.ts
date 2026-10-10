import {
  keccak256, parseAbiItem, toFunctionSelector,
  type Address, type Hex,
} from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { decodeCoreAction } from "./integration.abi.js";
import { importVerifiedSource } from "./integration.source.js";
import { readProxyImplementation } from "../chain/proxy.js";
import type { integrationDraftSchema } from "./integration.schema.js";
import type { z } from "zod";

type DraftInput = z.infer<typeof integrationDraftSchema>;
const zero = "0x0000000000000000000000000000000000000000";
const maxTraceCalls = 256;

function equal(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

type CallFrame = { type?: unknown; to?: unknown; input?: unknown; value?: unknown; error?: unknown; calls?: unknown };

function traceCall(frame: unknown, target: Address, selector: Hex, payable: boolean): { data: Hex; nativeValue: bigint } {
  const matches: { data: Hex; nativeValue: bigint }[] = [];
  let visited = 0;
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 16 || ++visited > maxTraceCalls) {
      throw new Error("integration-draft-trace-invalid");
    }
    const call = value as CallFrame;
    if (call.error != null || typeof call.type !== "string" || typeof call.to !== "string"
      || typeof call.input !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/.test(call.input)) {
      throw new Error("integration-draft-trace-invalid");
    }
    if (call.type === "CALL" && equal(call.to, target) && equal(call.input.slice(0, 10), selector)) {
      if ((payable || call.value !== undefined) && (typeof call.value !== "string" || !/^0x[0-9a-fA-F]+$/.test(call.value))) throw new Error("integration-draft-trace-invalid");
      matches.push({ data: call.input as Hex, nativeValue: call.value === undefined ? 0n : BigInt(String(call.value)) });
    }
    if (call.calls !== undefined) {
      if (!Array.isArray(call.calls) || call.calls.length > maxTraceCalls) {
        throw new Error("integration-draft-trace-invalid");
      }
      for (const child of call.calls) visit(child, depth + 1);
    }
  };
  visit(frame, 0);
  if (matches.length !== 1) throw new Error("integration-draft-reference-ambiguous");
  return matches[0]!;
}

async function observedCall(chain: ReturnType<typeof monadClient>, transaction: {
  to: Address | null; input: Hex; hash: Hex; value?: bigint;
}, target: Address, signature: string, core: Address): Promise<{
  callData: Hex; nativeValue: bigint; creditId: Hex | null; functionName: string; kind: "application" | "termbook" | "nested";
}> {
  const item = parseAbiItem(signature);
  if (item.type !== "function") throw new Error("integration-draft-signature-invalid");
  const selector = toFunctionSelector(item);
  if (transaction.to && equal(transaction.to, target) && equal(transaction.input.slice(0, 10), selector)) {
    return { callData: transaction.input, nativeValue: transaction.value ?? 0n, creditId: null, functionName: item.name, kind: "application" };
  }
  if (transaction.to && equal(transaction.to, core)) {
    try {
      const decoded = decodeCoreAction(transaction.input);
      const calls = decoded.calls.filter((call) => equal(call.target, target) && equal(call.data.slice(0, 10), selector));
      if (calls.length === 1) {
        return { callData: calls[0]!.data, nativeValue: calls[0]!.nativeValue, creditId: decoded.creditId, functionName: decoded.functionName, kind: "termbook" };
      }
    } catch {
      throw new Error("integration-draft-reference-invalid");
    }
    throw new Error("integration-draft-reference-invalid");
  }
  if (!transaction.to) throw new Error("integration-draft-reference-invalid");
  let frame: unknown;
  try {
    frame = await (chain as unknown as { request(args: { method: string; params: unknown[] }): Promise<unknown> })
      .request({ method: "debug_traceTransaction", params: [transaction.hash, { tracer: "callTracer" }] });
  } catch {
    throw new Error("integration-draft-trace-unavailable");
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new Error("integration-draft-trace-invalid");
  const root = frame as CallFrame;
  if (!equal(String(root.to), transaction.to) || !equal(String(root.input), transaction.input)) {
    throw new Error("integration-draft-trace-invalid");
  }
  const observed = traceCall(frame, target, selector, item.stateMutability === "payable");
  return { callData: observed.data, nativeValue: observed.nativeValue, creditId: null,
    functionName: item.name, kind: "nested" };
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
    if (signature.type !== "function" || !["nonpayable", "payable"].includes(signature.stateMutability)) {
      throw new Error("integration-draft-signature-invalid");
    }
    const [code, proxy, receipt, transaction] = await Promise.all([
      chain.getBytecode({ address: target, blockNumber: finalized.number }),
      readProxyImplementation(chain, target, finalized.number).catch(() => { throw new Error("integration-draft-proxy-mismatch"); }),
      chain.getTransactionReceipt({ hash: entry.txHash as Hex }),
      chain.getTransaction({ hash: entry.txHash as Hex }),
    ]);
    if (!code || code === "0x" || !equal(keccak256(code), entry.codeHash)) {
      throw new Error("integration-draft-code-mismatch");
    }
    const implementation = proxy?.implementation ?? zero as Address;
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
      || !equal(receipt.to ?? zero, transaction.to ?? zero) || !equal(transaction.hash, entry.txHash)
      || !equal(transaction.blockHash ?? "", receipt.blockHash)
      || receipt.logs.length > 256 || transaction.input.length > 200_002
      || receipt.logs.reduce((size, log) => size + log.data.length
        + log.topics.reduce((total, topic) => total + topic.length, 0), 0) > 500_000) {
      throw new Error("integration-draft-reference-invalid");
    }
    const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
    if (!equal(block.hash, receipt.blockHash)) throw new Error("integration-draft-reference-invalid");
    const [referenceCode, referenceProxy, referenceImplementationCode] = await Promise.all([
      chain.getBytecode({ address: target, blockNumber: receipt.blockNumber }),
      readProxyImplementation(chain, target, receipt.blockNumber),
      equal(implementation, zero) ? Promise.resolve(undefined)
        : chain.getBytecode({ address: implementation, blockNumber: receipt.blockNumber }),
    ]);
    if (!referenceCode || !equal(keccak256(referenceCode), entry.codeHash)
      || (referenceProxy?.slot ?? null) !== (proxy?.slot ?? null)
      || !equal(referenceProxy?.implementation ?? zero, implementation)
      || implementationCode && (!referenceImplementationCode
        || !equal(keccak256(referenceImplementationCode), keccak256(implementationCode)))) {
      throw new Error("integration-draft-reference-invalid");
    }
    const observed = await observedCall(chain, transaction, target, entry.signature, core);
    const selector = toFunctionSelector(signature);
    const [source, implementationSource] = await Promise.all([
      importVerifiedSource(env.monadChainId, target, code, equal(implementation, zero) ? selector : null),
      equal(implementation, zero) ? Promise.resolve(null) : importVerifiedSource(env.monadChainId,
        implementation, implementationCode!, selector),
    ]);
    entries.push({
      target, codeHash: entry.codeHash.toLowerCase(),
      implementation: equal(implementation, zero) ? null : implementation,
      implementationSlot: proxy?.slot ?? null,
      implementationCodeHash: entry.implementationCodeHash?.toLowerCase() ?? null,
      signature: entry.signature, selector, source, implementationSource,
      parameters: signature.inputs.map((param) => ({ name: param.name, type: param.type })),
      reference: { txHash: entry.txHash.toLowerCase(), blockNumber: receipt.blockNumber.toString(),
        creditId: observed.creditId, functionName: observed.functionName, kind: observed.kind,
        callData: observed.callData, nativeValue: observed.nativeValue.toString(),
        logs: receipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })) },
    });
  }
  return { chainId: env.monadChainId, finalizedBlock: finalized.number.toString(), entries };
}
