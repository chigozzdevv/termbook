import { settlementRepo } from "./settlement.repo.js";
import { HttpError } from "../http/http.errors.js";
import { env } from "../config/env.js";
import { monadClient } from "../chain/monad.client.js";
import { admittedRoute, requestAuroraQuote } from "./aurora.client.js";
import { encodeAbiParameters, keccak256 } from "viem";
import type { z } from "zod";
import type { settlementSchema } from "./settlement.schema.js";

const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";
const factoryAbi = [{ type: "function", name: "inboxOf", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] }] as const;
const registryAbi = [{ type: "function", name: "routes", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }, { type: "bytes32" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }] }] as const;
const registryPointerAbi = [{ type: "function", name: "routeRegistry", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const inboxAbi = [
  { type: "function", name: "vault", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "creditId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "minOut", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxReceived", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "refundRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deadline", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const houseAbi = [
  { type: "function", name: "settlementInboxes", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "lpInboxRecipient", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "lpInboxMinShares", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

type Input = z.infer<typeof settlementSchema>;

async function confirmedInbox(input: Input): Promise<`0x${string}`> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(env.settlementFactory)) throw new HttpError(503, "settlement-route-unavailable");
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new HttpError(503, "settlement-chain-mismatch");
  let finalizedBlock: bigint;
  try {
    finalizedBlock = (await chain.getBlock({ blockTag: "finalized" })).number;
  } catch {
    throw new HttpError(503, "settlement-finality-unavailable");
  }
  const inbox = await chain.readContract({ blockNumber: finalizedBlock, address: env.settlementFactory as `0x${string}`, abi: factoryAbi, functionName: "inboxOf", args: [input.operationId as `0x${string}`] });
  if (inbox.toLowerCase() === "0x0000000000000000000000000000000000000000") throw new HttpError(409, "settlement-inbox-required");
  const registry = await chain.readContract({ blockNumber: finalizedBlock, address: env.settlementFactory as `0x${string}`, abi: registryPointerAbi, functionName: "routeRegistry" });
  if (registry.toLowerCase() === "0x0000000000000000000000000000000000000000") throw new HttpError(503, "settlement-route-unavailable");
  const [adapter, pair, enabled, maximum, version] = await chain.readContract({ blockNumber: finalizedBlock, address: registry, abi: registryAbi, functionName: "routes", args: [input.routeId as `0x${string}`] });
  const expectedPair = keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
    [BigInt(input.sourceChain), input.sourceAsset as `0x${string}`, BigInt(env.monadChainId), input.token as `0x${string}`],
  ));
  if (!enabled || adapter.toLowerCase() === "0x0000000000000000000000000000000000000000" || pair !== expectedPair || maximum < BigInt(input.maxAmountIn) || `0x${version.toString(16).padStart(64, "0")}`.toLowerCase() !== input.routeVersion.toLowerCase()) throw new HttpError(403, "settlement-route-not-admitted");
  const [vault, token, creditId, minOut, maxReceived, refund, deadline, active, lpRecipient, minShares] = await Promise.all([
    chain.readContract({ blockNumber: finalizedBlock, address: inbox, abi: inboxAbi, functionName: "vault" }),
    chain.readContract({ blockNumber: finalizedBlock, address: inbox, abi: inboxAbi, functionName: "token" }),
    chain.readContract({ blockNumber: finalizedBlock, address: inbox, abi: inboxAbi, functionName: "creditId" }),
    chain.readContract({ blockNumber: finalizedBlock, address: inbox, abi: inboxAbi, functionName: "minOut" }),
    chain.readContract({ blockNumber: finalizedBlock, address: inbox, abi: inboxAbi, functionName: "maxReceived" }),
    chain.readContract({ blockNumber: finalizedBlock, address: inbox, abi: inboxAbi, functionName: "refundRecipient" }),
    chain.readContract({ blockNumber: finalizedBlock, address: inbox, abi: inboxAbi, functionName: "deadline" }),
    chain.readContract({ blockNumber: finalizedBlock, address: input.vault as `0x${string}`, abi: houseAbi, functionName: "settlementInboxes", args: [inbox] }),
    chain.readContract({ blockNumber: finalizedBlock, address: input.vault as `0x${string}`, abi: houseAbi, functionName: "lpInboxRecipient", args: [inbox] }),
    chain.readContract({ blockNumber: finalizedBlock, address: input.vault as `0x${string}`, abi: houseAbi, functionName: "lpInboxMinShares", args: [inbox] }),
  ]);
  if (
    !active || vault.toLowerCase() !== input.vault.toLowerCase() || token.toLowerCase() !== input.token.toLowerCase()
      || creditId.toLowerCase() !== (input.creditId ?? zero).toLowerCase()
      || minOut !== BigInt(input.minAmountOut) || maxReceived !== BigInt(input.maxReceived)
      || refund.toLowerCase() !== input.monadRefundRecipient.toLowerCase()
      || deadline !== BigInt(input.deadline)
      || (input.kind === "lp_deposit" && (lpRecipient.toLowerCase() !== input.lpRecipient?.toLowerCase() || minShares !== BigInt(input.minShares ?? "0")))
      || (input.kind !== "lp_deposit" && lpRecipient.toLowerCase() !== "0x0000000000000000000000000000000000000000")
  ) throw new HttpError(409, "settlement-inbox-mismatch");
  return inbox;
}

export const settlementService = {
  async register(input: Input) {
    const route = admittedRoute(input);
    const inbox = await confirmedInbox(input);
    const saved = await settlementRepo.save({ ...input, inbox });
    if (saved["quote"]) return saved;
    const lease = await settlementRepo.claimQuote(input.operationId);
    if (!lease) throw new HttpError(409, "settlement-quote-pending");
    try {
      const quote = await requestAuroraQuote({
        route,
        inbox,
        amountIn: input.maxAmountIn,
        minAmountOut: input.minAmountOut,
        maxReceived: input.maxReceived,
        sourceRefundRecipient: input.sourceRefundRecipient,
        deadline: input.deadline,
      });
      return settlementRepo.finishQuote(input.operationId, lease, quote);
    } catch (error) {
      await settlementRepo.releaseQuote(input.operationId, lease);
      throw error;
    }
  },
  async get(operationId: string) {
    return settlementRepo.get(operationId);
  },
};
