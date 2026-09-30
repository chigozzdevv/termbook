import {
  createPublicClient, createWalletClient, decodeFunctionData, encodeAbiParameters, encodeFunctionData,
  http, keccak256, parseAbi, type Address, type Hex, type PublicClient,
} from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { logger } from "../logging/logger.js";
import { SettlementModel } from "../settlement/settlement.model.js";
import { recoveryRepo, type RecoveryFundingClaim, type RecoveryFundingRecord } from "./recovery.repo.js";
import { recoveryConfig, type RecoveryConfig } from "./recovery.config.js";
import { recoveryFactoryOperation, recoveryFundingPlan, recoveryFundingTypedData, verifiedRiskSignature, verifyRoute, type Funding, type Operation } from "./recovery.plan.js";
import { fetchRecoveryOperationProof } from "./recovery.proof.js";
import { RecoveryModel } from "./recovery.model.js";

const factoryAbi = parseAbi([
  "function inboxOf(bytes32) view returns (address)",
  "function operationDigestOf(bytes32) view returns (bytes32)",
  "function routeRegistry() view returns (address)",
]);
const registryAbi = parseAbi(["function routes(bytes32) view returns (address,bytes32,bool,uint256,uint256)"]);
const inboxAbi = parseAbi([
  "function vault() view returns (address)",
  "function token() view returns (address)",
  "function creditId() view returns (bytes32)",
  "function minOut() view returns (uint256)",
  "function maxReceived() view returns (uint256)",
  "function deadline() view returns (uint256)",
  "function refundRecipient() view returns (address)",
]);
const houseAbi = parseAbi([
  "function core() view returns (address)",
  "function asset() view returns (address)",
  "function settlementInboxes(address) view returns (bool)",
]);
const coreAbi = parseAbi([
  "function remoteRecoveryContext(bytes32) view returns (uint256,address,address)",
  "function creditDebt(bytes32) view returns (uint256)",
  "function creditVault(bytes32) view returns (address)",
  "function recoveryRefundRecipientOf(bytes32) view returns (address)",
  "function minimumRemoteRecoveryProceeds(bytes32,uint256) view returns (uint256)",
  "function recoveryKeepers(address) view returns (bool)",
  "function creditFacility(bytes32) view returns (uint8)",
  "function pendingRemoteSeizure(bytes32) view returns (uint256)",
]);
const sourceAbi = parseAbi([
  "function asset() view returns (address)",
  "function monadChain() view returns (uint256)",
  "function routeSigner() view returns (address)",
  "function riskSigner() view returns (address)",
  "function monadFactory() view returns (address)",
  "function verifier() view returns (address)",
  "function controller() view returns (address)",
  "function held(bytes32) view returns (uint256)",
  "function usedOperation(bytes32) view returns (bool)",
  "function fund((bytes32 creditId,bytes32 operationId,address inbox,address depositAddress,uint256 amount,bytes32 quoteHash,uint256 nonce,uint256 deadline),(bytes32 operationId,uint8 kind,address payer,uint256 sourceChain,address sourceAsset,address vault,address token,bytes32 creditId,uint256 maxAmountIn,uint256 minOut,uint256 maxReceived,address sourceRefund,address refundRecipient,uint256 deadline,bytes32 routeId,bytes32 routeVersion,address lpRecipient,uint256 minShares),bytes header,bytes proof,bytes routeSignature,bytes riskSignature)",
]);
const controllerAbi = parseAbi([
  "function recoveryVault() view returns (address)",
  "function monadCore() view returns (address)",
  "function monadChain() view returns (uint256)",
  "function verifier() view returns (address)",
]);
const verifierAbi = parseAbi([
  "function admission() view returns (uint256,uint256,bytes32)",
  "function wormholeMode() pure returns (bool)",
  "function verifyRecoveryOperation(bytes header,bytes proof,address emitter,bytes32 eventDigest) view returns (bool)",
]);

let running = false;
const equal = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
const errorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  return /^(recovery|settlement|aurora)-[a-z0-9-]+$/.test(message) ? message : "recovery-dependency-error";
};

export async function verifyRegisteredRecoveryOperation(operation: Operation, digest: `0x${string}`): Promise<void> {
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new Error("recovery-monad-chain-mismatch");
  const blockNumber = (await chain.getBlock({ blockTag: "finalized" })).number;
  const factory = env.settlementFactory as `0x${string}`;
  const inbox = operation.inbox as `0x${string}`;
  const vault = operation.vault as `0x${string}`;
  const [registered, registeredDigest, routeRegistry, actualVault, token, creditId, minOut, cap, deadline, refundRecipient, core, houseAsset, active] = await Promise.all([
    chain.readContract({ address: factory, abi: factoryAbi, functionName: "inboxOf", args: [operation.operationId as `0x${string}`], blockNumber }),
    chain.readContract({ address: factory, abi: factoryAbi, functionName: "operationDigestOf", args: [operation.operationId as `0x${string}`], blockNumber }),
    chain.readContract({ address: factory, abi: factoryAbi, functionName: "routeRegistry", blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "vault", blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "token", blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "creditId", blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "minOut", blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "maxReceived", blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "deadline", blockNumber }),
    chain.readContract({ address: inbox, abi: inboxAbi, functionName: "refundRecipient", blockNumber }),
    chain.readContract({ address: vault, abi: houseAbi, functionName: "core", blockNumber }),
    chain.readContract({ address: vault, abi: houseAbi, functionName: "asset", blockNumber }),
    chain.readContract({ address: vault, abi: houseAbi, functionName: "settlementInboxes", args: [inbox], blockNumber }),
  ]);
  if (
    !equal(registered, inbox) || !equal(registeredDigest, digest) || !equal(actualVault, vault)
      || !equal(token, operation.token) || !equal(houseAsset, operation.token)
      || !equal(creditId, operation.creditId) || minOut !== BigInt(operation.minAmountOut)
      || cap !== BigInt(operation.maxReceived) || deadline !== BigInt(operation.deadline)
      || !equal(refundRecipient, operation.refundRecipient) || !equal(core, env.core) || !active
  ) throw new Error("recovery-monad-binding-mismatch");
  const [adapter, pair, enabled, maximum, version] = await chain.readContract({
    address: routeRegistry, abi: registryAbi, functionName: "routes", args: [operation.routeId as `0x${string}`], blockNumber,
  });
  const expectedPair = keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
    [BigInt(operation.sourceChain), operation.sourceAsset as `0x${string}`, BigInt(env.monadChainId), operation.token as `0x${string}`],
  ));
  if (
    equal(adapter, "0x0000000000000000000000000000000000000000") || !enabled || pair !== expectedPair
      || maximum < BigInt(operation.maxAmountIn) || version !== BigInt(operation.routeVersion)
  ) throw new Error("recovery-route-not-admitted");
  const adapterCode = await chain.getCode({ address: adapter, blockNumber });
  if (!adapterCode || adapterCode === "0x") throw new Error("recovery-route-not-admitted");
  const [context, debt, creditVault, owner, keeper, facility, pending, minimumProceeds] = await Promise.all([
    chain.readContract({ address: core, abi: coreAbi, functionName: "remoteRecoveryContext", args: [operation.creditId as `0x${string}`], blockNumber }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "creditDebt", args: [operation.creditId as `0x${string}`], blockNumber }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "creditVault", args: [operation.creditId as `0x${string}`], blockNumber }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "recoveryRefundRecipientOf", args: [operation.creditId as `0x${string}`], blockNumber }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "recoveryKeepers", args: [operation.payer as `0x${string}`], blockNumber }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "creditFacility", args: [operation.creditId as `0x${string}`], blockNumber }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "pendingRemoteSeizure", args: [operation.creditId as `0x${string}`], blockNumber }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "minimumRemoteRecoveryProceeds", args: [operation.creditId as `0x${string}`, BigInt(operation.maxAmountIn)], blockNumber }),
  ]);
  if (
    context[0] !== BigInt(operation.sourceChain) || !equal(context[1], operation.sourceAsset)
      || !equal(context[2], operation.sourceRefundRecipient) || debt === 0n
      || !equal(creditVault, vault) || !equal(owner, operation.refundRecipient)
      || !keeper || ![8, 9, 10].includes(facility) || pending !== 0n
      || BigInt(operation.minAmountOut) < minimumProceeds
  ) throw new Error("recovery-credit-mismatch");
}

async function reconcileSignedFunding(
  operation: Operation, funding: Funding, claim: RecoveryFundingClaim,
  source: PublicClient, finalized: { number: bigint; timestamp: bigint }, fallbackFunder: Address,
): Promise<boolean> {
  const funder = claim.fundingFunder ?? fallbackFunder;
  const hash = claim.fundingTxHash as Hex | undefined;
  const rawTx = claim.fundingRawTx as Hex | undefined;
  const nonce = claim.fundingNonce;
  if (!/^0x[a-fA-F0-9]{40}$/.test(funder)) throw new Error("recovery-funder-invalid");
  if (!hash || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    if (finalized.timestamp <= funding.deadline) {
      await recoveryRepo.release(operation.operationId, claim.token);
      return false;
    }
    const used = await source.readContract({
      address: operation.sourceRefundRecipient as Address, abi: sourceAbi,
      functionName: "usedOperation", args: [funding.operationId], blockNumber: finalized.number,
    });
    await recoveryRepo.update(operation.operationId, claim.token, used ? "manual_review" : "expired", {
      failure: used ? "recovery-funding-tx-unattributed" : "recovery-signed-transaction-missing",
    });
    await recoveryRepo.releaseFunder(operation.sourceChain, funder, operation.operationId);
    return true;
  }
  if (!await recoveryRepo.acquireFunder(operation.sourceChain, funder, operation.operationId)) {
    await recoveryRepo.release(operation.operationId, claim.token);
    return false;
  }
  let receipt = await source.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) {
    if (finalized.timestamp > funding.deadline) {
      const used = await source.readContract({
        address: operation.sourceRefundRecipient as Address, abi: sourceAbi,
        functionName: "usedOperation", args: [funding.operationId], blockNumber: finalized.number,
      });
      await recoveryRepo.update(operation.operationId, claim.token, used ? "manual_review" : "expired", {
        failure: used ? "recovery-funding-tx-unattributed" : "recovery-funding-deadline-expired",
      });
      await recoveryRepo.releaseFunder(operation.sourceChain, funder, operation.operationId);
      return true;
    }
    if (!rawTx || !/^0x[a-fA-F0-9]+$/.test(rawTx) || keccak256(rawTx).toLowerCase() !== hash.toLowerCase()
      || !Number.isSafeInteger(nonce) || nonce! < 0) {
      await recoveryRepo.release(operation.operationId, claim.token);
      return false;
    }
    try {
      const sent = await source.sendRawTransaction({ serializedTransaction: rawTx });
      if (!equal(sent, hash)) throw new Error("recovery-funding-tx-hash-mismatch");
      await recoveryRepo.markSubmitted(operation.operationId, claim.token);
    } catch (error) {
      if (!(error instanceof Error) || !/already known|known transaction|nonce too low/i.test(error.message)) throw error;
    }
    receipt = await source.getTransactionReceipt({ hash }).catch(() => null);
  }
  if (!receipt) {
    const currentNonce = await source.getTransactionCount({ address: funder as Address, blockNumber: finalized.number });
    if (currentNonce > nonce!) {
      await recoveryRepo.update(operation.operationId, claim.token, "manual_review", { failure: "recovery-funding-tx-replaced" });
      await recoveryRepo.releaseFunder(operation.sourceChain, funder, operation.operationId);
      return true;
    }
    await recoveryRepo.release(operation.operationId, claim.token);
    return false;
  }
  if (receipt.blockNumber > finalized.number) {
    await recoveryRepo.release(operation.operationId, claim.token);
    return false;
  }
  const canonical = await source.getBlock({ blockNumber: receipt.blockNumber });
  if (!equal(canonical.hash, receipt.blockHash)
    || !equal(canonical.transactions[receipt.transactionIndex] ?? "", hash)
    || !equal(receipt.transactionHash, hash)) {
    await recoveryRepo.release(operation.operationId, claim.token);
    return false;
  }
  if (receipt.status !== "success") {
    await recoveryRepo.update(operation.operationId, claim.token, "manual_review", { failure: "recovery-funding-tx-reverted" });
    await recoveryRepo.releaseFunder(operation.sourceChain, funder, operation.operationId);
    return true;
  }
  const tx = await source.getTransaction({ hash });
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: sourceAbi, data: tx.input });
  } catch {
    await recoveryRepo.update(operation.operationId, claim.token, "manual_review", { failure: "recovery-funding-tx-mismatch" });
    await recoveryRepo.releaseFunder(operation.sourceChain, funder, operation.operationId);
    return true;
  }
  const submitted = decoded.functionName === "fund" ? decoded.args[0] : null;
  const submittedOperation = decoded.functionName === "fund" ? decoded.args[1] : null;
  const expectedOperation = recoveryFactoryOperation(operation);
  if (
    !equal(tx.to ?? "", operation.sourceRefundRecipient) || !equal(tx.from, funder)
      || !submitted || !submittedOperation
      || !equal(submitted.creditId, funding.creditId) || !equal(submitted.operationId, funding.operationId)
      || !equal(submitted.inbox, funding.inbox) || !equal(submitted.depositAddress, funding.depositAddress)
      || submitted.amount !== funding.amount || !equal(submitted.quoteHash, funding.quoteHash)
      || submitted.nonce !== funding.nonce || submitted.deadline !== funding.deadline
      || Object.entries(expectedOperation).some(([key, value]) =>
        String(submittedOperation[key as keyof typeof submittedOperation]).toLowerCase() !== String(value).toLowerCase())
  ) {
    await recoveryRepo.update(operation.operationId, claim.token, "manual_review", { failure: "recovery-funding-tx-mismatch" });
    await recoveryRepo.releaseFunder(operation.sourceChain, funder, operation.operationId);
    return true;
  }
  const used = await source.readContract({
    address: operation.sourceRefundRecipient as Address, abi: sourceAbi,
    functionName: "usedOperation", args: [funding.operationId], blockNumber: finalized.number,
  });
  if (!used) {
    await recoveryRepo.update(operation.operationId, claim.token, "manual_review", { failure: "recovery-funding-unrecorded" });
    await recoveryRepo.releaseFunder(operation.sourceChain, funder, operation.operationId);
    return true;
  }
  await recoveryRepo.update(operation.operationId, claim.token, "confirmed", { sourceBlockHash: receipt.blockHash });
  await recoveryRepo.releaseFunder(operation.sourceChain, funder, operation.operationId);
  return true;
}

async function reconcile(operation: Operation, record: RecoveryFundingRecord, funding: Funding, digest: `0x${string}`, config: RecoveryConfig): Promise<boolean> {
  const rpc = config.sourceRpcs[operation.sourceChain];
  if (!rpc) throw new Error("recovery-source-rpc-unavailable");
  const claim = await recoveryRepo.claim(record);
  if (!claim) return false;
  try {
    let riskSignature: `0x${string}` | undefined;
    if (claim.state === "pending") {
      const approval = await recoveryRepo.riskApproval(operation.operationId.toLowerCase());
      if (!approval) {
        await recoveryRepo.release(operation.operationId, claim.token);
        return false;
      }
      riskSignature = await verifiedRiskSignature(operation, funding, approval, config.riskSigner);
    }
    const source = createPublicClient({ transport: http(rpc) });
    if (await source.getChainId() !== operation.sourceChain) throw new Error("recovery-source-chain-mismatch");
    const finalizedBlock = await source.getBlock({ blockTag: "finalized" });
    const finalized = finalizedBlock.number;
    const vault = operation.sourceRefundRecipient as `0x${string}`;
    if (claim.state !== "pending") {
      return reconcileSignedFunding(operation, funding, claim, source, finalizedBlock, config.funder.address);
    }
    if (operation.providerStatus && operation.providerStatus !== "PENDING_DEPOSIT") {
      await recoveryRepo.update(operation.operationId, claim.token, "manual_review", { failure: "recovery-route-already-active" });
      return true;
    }
    verifyRoute(operation);
    await verifyRegisteredRecoveryOperation(operation, digest);
    const [asset, monadChain, monadFactory, verifier, routeSigner, riskSigner, controller, held, used] = await Promise.all([
      source.readContract({ address: vault, abi: sourceAbi, functionName: "asset", blockNumber: finalized }),
      source.readContract({ address: vault, abi: sourceAbi, functionName: "monadChain", blockNumber: finalized }),
      source.readContract({ address: vault, abi: sourceAbi, functionName: "monadFactory", blockNumber: finalized }),
      source.readContract({ address: vault, abi: sourceAbi, functionName: "verifier", blockNumber: finalized }),
      source.readContract({ address: vault, abi: sourceAbi, functionName: "routeSigner", blockNumber: finalized }),
      source.readContract({ address: vault, abi: sourceAbi, functionName: "riskSigner", blockNumber: finalized }),
      source.readContract({ address: vault, abi: sourceAbi, functionName: "controller", blockNumber: finalized }),
      source.readContract({ address: vault, abi: sourceAbi, functionName: "held", args: [funding.creditId], blockNumber: finalized }),
      source.readContract({ address: vault, abi: sourceAbi, functionName: "usedOperation", args: [funding.operationId], blockNumber: finalized }),
    ]);
    if (used) {
      await recoveryRepo.update(operation.operationId, claim.token, "manual_review", { failure: "recovery-operation-already-used" });
      return true;
    }
    if (
      !equal(asset, operation.sourceAsset) || monadChain !== BigInt(env.monadChainId)
        || !equal(monadFactory, env.settlementFactory)
        || !equal(routeSigner, config.routeSigner.address) || !equal(riskSigner, config.riskSigner)
        || equal(controller, "0x0000000000000000000000000000000000000000")
    ) throw new Error("recovery-source-binding-mismatch");
    const [controllerVault, controllerCore, controllerMonadChain, controllerVerifier, admission] = await Promise.all([
      source.readContract({ address: controller, abi: controllerAbi, functionName: "recoveryVault", blockNumber: finalized }),
      source.readContract({ address: controller, abi: controllerAbi, functionName: "monadCore", blockNumber: finalized }),
      source.readContract({ address: controller, abi: controllerAbi, functionName: "monadChain", blockNumber: finalized }),
      source.readContract({ address: controller, abi: controllerAbi, functionName: "verifier", blockNumber: finalized }),
      source.readContract({ address: verifier, abi: verifierAbi, functionName: "admission", blockNumber: finalized }),
    ]);
    if (!equal(controllerVault, vault) || !equal(controllerCore, env.core)
      || controllerMonadChain !== BigInt(env.monadChainId) || !equal(controllerVerifier, verifier)
      || admission[0] !== BigInt(env.monadChainId)) {
      throw new Error("recovery-controller-mismatch");
    }
    if (held < funding.amount) {
      await recoveryRepo.release(operation.operationId, claim.token);
      return false;
    }
    if (Date.now() + 120_000 >= record.deadline * 1000 || Date.now() + 120_000 >= operation.deadline * 1000) {
      await recoveryRepo.update(operation.operationId, claim.token, "expired");
      return true;
    }
    const latestUsed = await source.readContract({ address: vault, abi: sourceAbi, functionName: "usedOperation", args: [funding.operationId] });
    if (latestUsed) {
      await recoveryRepo.update(operation.operationId, claim.token, "manual_review", { failure: "recovery-operation-already-used" });
      return true;
    }
    const signedFunding = recoveryFundingTypedData(operation, funding);
    if (!riskSignature) throw new Error("recovery-risk-approval-missing");
    const wormhole = await source.readContract({
      address: verifier, abi: verifierAbi, functionName: "wormholeMode",
    }).catch(() => false);
    let routeProof = await fetchRecoveryOperationProof(operation, digest, wormhole);
    const eventDigest = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
      [funding.operationId, digest, funding.inbox],
    ));
    let verified = await source.readContract({
      address: verifier, abi: verifierAbi, functionName: "verifyRecoveryOperation",
      args: [routeProof.header, routeProof.proof, env.settlementFactory as `0x${string}`, eventDigest],
    });
    if (!verified && wormhole) {
      routeProof = await fetchRecoveryOperationProof(operation, digest, true, true);
      verified = await source.readContract({
        address: verifier, abi: verifierAbi, functionName: "verifyRecoveryOperation",
        args: [routeProof.header, routeProof.proof, env.settlementFactory as `0x${string}`, eventDigest],
      });
    }
    if (!verified) throw new Error("recovery-operation-proof-rejected");
    const routeSignature = await config.routeSigner.signTypedData(signedFunding);
    const fundArgs = [funding, recoveryFactoryOperation(operation), routeProof.header, routeProof.proof, routeSignature, riskSignature] as const;
    await source.simulateContract({ address: vault, abi: sourceAbi, functionName: "fund", args: fundArgs, account: config.funder.address });
    if (!await recoveryRepo.acquireFunder(operation.sourceChain, config.funder.address, operation.operationId)) {
      await recoveryRepo.release(operation.operationId, claim.token);
      return false;
    }
    let prepared = false;
    try {
      const wallet = createWalletClient({ account: config.funder, transport: http(rpc) });
      const nonce = await source.getTransactionCount({ address: config.funder.address, blockTag: "pending" });
      const request = await wallet.prepareTransactionRequest({
        account: config.funder, chain: null, to: vault,
        data: encodeFunctionData({ abi: sourceAbi, functionName: "fund", args: fundArgs }), nonce,
      });
      const rawTx = await wallet.signTransaction({ ...request, chain: null });
      const hash = keccak256(rawTx);
      const result = await recoveryRepo.prepareSubmission(
        operation.operationId, claim.token, config.funder.address, hash, rawTx, nonce,
      );
      if (result.matchedCount === 1) {
        prepared = true;
        claim.state = "prepared";
        claim.fundingTxHash = hash;
        claim.fundingRawTx = rawTx;
        claim.fundingNonce = nonce;
        claim.fundingFunder = config.funder.address;
      } else {
        const winner = await recoveryRepo.get(operation.operationId);
        if (!winner?.fundingTxHash || !winner.fundingRawTx) throw new Error("recovery-submission-conflict");
        prepared = true;
        if (winner.leaseToken !== claim.token) return false;
        claim.state = winner.state as string;
        claim.fundingTxHash = winner.fundingTxHash as string;
        claim.fundingRawTx = winner.fundingRawTx as string;
        claim.fundingNonce = winner.fundingNonce as number;
        claim.fundingFunder = winner.fundingFunder as string;
      }
      return await reconcileSignedFunding(operation, funding, claim, source, finalizedBlock, config.funder.address);
    } catch (error) {
      if (!prepared) {
        const current = await recoveryRepo.get(operation.operationId).catch(() => null);
        if (current && !current.fundingTxHash) {
          await recoveryRepo.releaseFunder(operation.sourceChain, config.funder.address, operation.operationId);
        }
      }
      throw error;
    }
  } catch (error) {
    await recoveryRepo.release(operation.operationId, claim.token);
    throw error;
  }
}

export async function runRecoveryWorker(): Promise<number> {
  const config = recoveryConfig();
  if (!config || running) return 0;
  if (!/^0x[a-fA-F0-9]{40}$/.test(env.settlementFactory) || !/^0x[a-fA-F0-9]{40}$/.test(env.core)) throw new Error("recovery-monad-config-invalid");
  running = true;
  let count = 0;
  try {
    const operations = await SettlementModel.aggregate([
      { $match: { kind: "recovery", inbox: { $exists: true }, quote: { $exists: true } } },
      { $lookup: { from: RecoveryModel.collection.name, localField: "operationId", foreignField: "operationId", as: "funding" } },
      { $match: { "funding.state": { $nin: ["confirmed", "expired", "manual_review"] } } },
      { $sort: { updatedAt: 1 } },
      { $limit: 25 },
    ]);
    for (const candidate of operations) {
      try {
        const { operation, record, funding, digest } = recoveryFundingPlan(candidate);
        if (await reconcile(operation, record, funding, digest, config)) count++;
      } catch (error) {
        logger.warn("recovery-reconciliation-failed", { operationId: candidate.operationId, reason: errorCode(error) });
      }
    }
  } finally {
    running = false;
  }
  return count;
}
