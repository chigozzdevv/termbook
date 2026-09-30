import { createPublicClient, encodeAbiParameters, encodeFunctionData, http, keccak256,
  parseAbi, stringToHex, type Address, type Hex } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { keeperTransaction } from "../chain/keeper.js";
import { fetchWormholeVaaById } from "../chain/wormhole-vaa.js";
import { fetchEthereumSnapshot } from "../chain/ethereum-wormhole-snapshot.js";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { SettlementModel } from "../settlement/settlement.model.js";
import { recoveryRelayConfig } from "./relay.config.js";

const factoryAbi = parseAbi([
  "function recoverySettled(bytes32) view returns (bool)",
  "function recoveryCancelled(bytes32) view returns (bool)",
  "function recoverySettlementSequence(bytes32) view returns (uint64)",
  "function recoverySettlementPublishedAt(bytes32) view returns (uint256)",
  "function operationDigestOf(bytes32) view returns (bytes32)",
  "function ethereumWormholeCore() view returns (address)",
  "function publishEthereumRecoverySettlement(bytes32) payable",
]);
const sourceAbi = parseAbi([
  "function monadFactory() view returns (address)",
  "function monadChain() view returns (uint256)",
  "function controller() view returns (address)",
  "function verifier() view returns (address)",
  "function operationPending(bytes32) view returns (bool)",
  "function inFlight(bytes32) view returns (bytes32,uint256)",
  "function deliveryDigest(bytes32) view returns (bytes32)",
  "function confirmDelivery(bytes32,bytes,bytes)",
]);
const inboxAbi = parseAbi([
  "function creditId() view returns (bytes32)", "function vault() view returns (address)",
  "function applied() view returns (uint256)", "function refunded() view returns (uint256)",
  "function untrackedApplied() view returns (uint256)", "function untrackedRefunded() view returns (uint256)",
  "function minOut() view returns (uint256)", "function available() view returns (uint256)",
]);
const verifierAbi = parseAbi(["function proofMaxAge() view returns (uint256)"]);
const feeAbi = parseAbi(["function messageFee() view returns (uint256)"]);
const settlementDomain = keccak256(stringToHex("Termbook Wormhole recovery settlement v1"));
const coreAbi = parseAbi(["function cancelRefundedRecoveryOperation(bytes32,bytes32,bytes,bytes)"]);
type Record = { operationId: Hex; creditId: Hex; inbox: Address; sourceRefundRecipient: Address; vault: Address };
let running = false;

export async function runRecoveryRelayWorker(): Promise<number> {
  const config = recoveryRelayConfig();
  if (!config || running) return 0;
  running = true;
  try {
    const monad = monadClient();
    const source = createPublicClient({ transport: http(env.sourceRpcUrl) });
    if (await monad.getChainId() !== env.monadChainId || await source.getChainId() !== 1) {
      throw new Error("recovery-relay-chain-mismatch");
    }
    const factory = env.settlementFactory as Address;
    const operations = await SettlementModel.find({ kind: "recovery", sourceChain: 1,
      inbox: { $exists: true } }).sort({ relayCheckedAt: 1 }).limit(10).lean();
    let processed = 0;
    for (const doc of operations) {
      const op = doc as unknown as Record;
      try {
        const at = (await monad.getBlock({ blockTag: "finalized" })).number;
        const sourceAt = (await source.getBlock({ blockTag: "finalized" })).number;
        const [pending, flight, boundFactory, chainId, controller, verifier, storedDigest] = await Promise.all([
          source.readContract({ address: op.sourceRefundRecipient, abi: sourceAbi, functionName: "operationPending", args: [op.operationId], blockNumber: sourceAt }),
          source.readContract({ address: op.sourceRefundRecipient, abi: sourceAbi, functionName: "inFlight", args: [op.operationId], blockNumber: sourceAt }),
          source.readContract({ address: op.sourceRefundRecipient, abi: sourceAbi, functionName: "monadFactory", blockNumber: sourceAt }),
          source.readContract({ address: op.sourceRefundRecipient, abi: sourceAbi, functionName: "monadChain", blockNumber: sourceAt }),
          source.readContract({ address: op.sourceRefundRecipient, abi: sourceAbi, functionName: "controller", blockNumber: sourceAt }),
          source.readContract({ address: op.sourceRefundRecipient, abi: sourceAbi, functionName: "verifier", blockNumber: sourceAt }),
          source.readContract({ address: op.sourceRefundRecipient, abi: sourceAbi, functionName: "deliveryDigest", args: [op.operationId], blockNumber: sourceAt }),
        ]);
        if (boundFactory.toLowerCase() !== factory.toLowerCase() || chainId !== BigInt(env.monadChainId)
          || flight[0].toLowerCase() !== op.creditId.toLowerCase()) throw new Error("recovery-relay-binding-mismatch");
        const [actualCredit, vault, digest, cancelled, settled] = await Promise.all([
          monad.readContract({ address: op.inbox, abi: inboxAbi, functionName: "creditId", blockNumber: at }),
          monad.readContract({ address: op.inbox, abi: inboxAbi, functionName: "vault", blockNumber: at }),
          monad.readContract({ address: factory, abi: factoryAbi, functionName: "operationDigestOf", args: [op.operationId], blockNumber: at }),
          monad.readContract({ address: factory, abi: factoryAbi, functionName: "recoveryCancelled", args: [op.operationId], blockNumber: at }),
          monad.readContract({ address: factory, abi: factoryAbi, functionName: "recoverySettled", args: [op.operationId], blockNumber: at }),
        ]);
        const delivered = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
          [op.operationId, digest, op.inbox]));
        if (delivered !== storedDigest || actualCredit.toLowerCase() !== op.creditId.toLowerCase()
          || vault.toLowerCase() !== op.vault.toLowerCase()) throw new Error("recovery-relay-binding-mismatch");
        if (cancelled || (settled && !pending)) continue;
        if (flight[1] === 0n && !settled) {
          const core = env.core as Address;
          const registryAbi = parseAbi(["function verifierRegistry() view returns (address)"]);
          const registry = await monad.readContract({ address: core, abi: registryAbi, functionName: "verifierRegistry", blockNumber: at });
          const sourceVerifier = (await monad.readContract({ address: registry, abi: parseAbi([
            "function verifiers(uint256) view returns (address,uint256,bool,uint256,bytes32)"]), functionName: "verifiers", args: [1n], blockNumber: at }))[0];
          const sourceVault = await monad.readContract({ address: sourceVerifier,
            abi: parseAbi(["function sourceVault() view returns (address)"]), functionName: "sourceVault", blockNumber: at });
          const snapshot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
            [op.creditId, op.sourceRefundRecipient, op.operationId, delivered]));
          const proof = await fetchEthereumSnapshot({ verifier: sourceVerifier, vault: sourceVault,
            controller, kind: 5, operationId: op.operationId, digest: snapshot });
          const data = encodeFunctionData({ abi: coreAbi, functionName: "cancelRefundedRecoveryOperation",
            args: [op.creditId, op.operationId, proof.header, proof.proof] });
          await monad.call({ account: config.monad.address, to: core, data });
          await keeperTransaction({ client: monad, rpcUrl: env.rpcUrl, chainId: env.monadChainId,
            account: config.monad, operation: `${op.operationId}:source-refunded`, to: core, data });
          processed++; continue;
        }
        if (!pending) continue;
        const [applied, refunded, untrackedApplied, untrackedRefunded, minimum, available, publishedAt, maximumAge] = await Promise.all([
          monad.readContract({ address: op.inbox, abi: inboxAbi, functionName: "applied", blockNumber: at }),
          monad.readContract({ address: op.inbox, abi: inboxAbi, functionName: "refunded", blockNumber: at }),
          monad.readContract({ address: op.inbox, abi: inboxAbi, functionName: "untrackedApplied", blockNumber: at }),
          monad.readContract({ address: op.inbox, abi: inboxAbi, functionName: "untrackedRefunded", blockNumber: at }),
          monad.readContract({ address: op.inbox, abi: inboxAbi, functionName: "minOut", blockNumber: at }),
          monad.readContract({ address: op.inbox, abi: inboxAbi, functionName: "available", blockNumber: at }),
          monad.readContract({ address: factory, abi: factoryAbi, functionName: "recoverySettlementPublishedAt", args: [op.operationId], blockNumber: at }),
          source.readContract({ address: verifier, abi: verifierAbi, functionName: "proofMaxAge", blockNumber: sourceAt }),
        ]);
        if (available !== 0n || (!settled && applied + refunded + untrackedApplied + untrackedRefunded < minimum)) continue;
        const finalized = await monad.getBlock({ blockTag: "finalized" });
        if (publishedAt === 0n || finalized.timestamp - publishedAt > maximumAge / 2n) {
          const wormhole = await monad.readContract({ address: factory, abi: factoryAbi, functionName: "ethereumWormholeCore" });
          const value = await monad.readContract({ address: wormhole, abi: feeAbi, functionName: "messageFee" });
          const data = encodeFunctionData({ abi: factoryAbi, functionName: "publishEthereumRecoverySettlement", args: [op.operationId] });
          await keeperTransaction({ client: monad, rpcUrl: env.rpcUrl, chainId: env.monadChainId,
            account: config.monad, operation: `${op.operationId}:settlement:${publishedAt}`, to: factory, data, value });
          processed++; continue;
        }
        const sequence = await monad.readContract({ address: factory, abi: factoryAbi,
          functionName: "recoverySettlementSequence", args: [op.operationId], blockNumber: at });
        const proof = await fetchWormholeVaaById({ chain: 48, emitter: factory, sequence,
          payload: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [settlementDomain, delivered]) });
        const data = encodeFunctionData({ abi: sourceAbi, functionName: "confirmDelivery",
          args: [op.operationId, proof.header, proof.proof] });
        await source.call({ to: op.sourceRefundRecipient, data, account: config.ethereum.address });
        await keeperTransaction({ client: source, rpcUrl: env.sourceRpcUrl, chainId: 1, account: config.ethereum,
          operation: `${op.operationId}:delivered`, to: op.sourceRefundRecipient, data });
        processed++;
      } catch (error) {
        logger.warn("recovery-relay-failed", { operationId: op.operationId,
          reason: error instanceof Error ? error.message : "unknown" });
      } finally {
        await SettlementModel.updateOne({ operationId: op.operationId }, { $set: { relayCheckedAt: new Date() } });
      }
    }
    return processed;
  } finally { running = false; }
}
