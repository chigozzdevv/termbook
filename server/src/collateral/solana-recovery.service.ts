import { termbookCoreAbi, verifierRegistryAbi } from "@termbook/bindings";
import { quoteHash, verifyQuoteSignature, type OneClickQuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { concatHex, decodeAbiParameters, encodeFunctionData, keccak256, parseAbi, stringToHex,
  type Address, type Hex, type TransactionReceipt } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { solanaAlias } from "../quote/solana.js";
import { fetchSolanaProof } from "./solana-proof.js";
import { solanaBase58Bytes } from "./solana-proof.js";
import { settlementRepo } from "../settlement/settlement.repo.js";
import type { z } from "zod";
import type { solanaRecoveryFundingConfirmationSchema, solanaRecoveryFundingPlanSchema,
  solanaRecoveryPayoutConfirmationSchema, solanaRecoveryRefundReconciliationSchema } from "./solana-recovery.schema.js";

const coreAbi = parseAbi([
  "function solanaCollateral(bytes32) view returns (bool)",
  "function solanaIdentityOf(bytes32) view returns (bytes32 sourceGenesis,bytes32 programId,bytes32 sourceAsset,bytes32 sourceOwner,bytes32 returnRecipient,bytes32 recoveryVault,uint64 verifierVersion)",
  "function solanaLockPdaOf(bytes32) view returns (bytes32)",
  "function collateralSourceChainOf(bytes32) view returns (uint256)",
  "function solanaMarkets(uint256) view returns (bytes32 sourceGenesis,bytes32 programId,bytes32 programDataHash,bytes32 sourceAsset,bool active)",
  "function solanaRecoveryFactory() view returns (address)",
  "function solanaRecoveryFactoryCodeHash() view returns (bytes32)",
  "function solanaRecoveryOperationFunded(bytes32) view returns (bool)",
  "function pendingSolanaFundingHash(bytes32) view returns (bytes32)",
  "function pendingSolanaFundingOperation(bytes32) view returns (bytes32)",
  "function pendingSolanaFundingAmount(bytes32) view returns (uint256)",
  "function pendingSolanaFundingNonce(bytes32) view returns (uint256)",
  "function pendingSolanaFundingDeadline(bytes32) view returns (uint256)",
  "function pendingSolanaPayoutHash(bytes32) view returns (bytes32)",
  "function pendingSolanaPayoutNonce(bytes32) view returns (uint256)",
  "function pendingSolanaPayoutDeadline(bytes32) view returns (uint256)",
  "function solanaRecoveryRefunded(bytes32) view returns (uint256)",
  "function remoteSeizureConfirmed(bytes32) view returns (bool)",
  "function recoveryKeepers(address) view returns (bool)",
  "function solanaRecoveryFundHash((bytes32 creditId,bytes32 operationId,address inbox,bytes32 depositPubkey,uint256 amount,bytes32 quoteHash,uint256 deadline) funding,bytes32 operationDigest,uint256 nonce,uint256 revision) view returns (bytes32)",
  "function confirmSolanaRecoveryFund(bytes32 creditId,bytes header,bytes proof)",
  "function cancelExpiredSolanaRecoveryFund(bytes32 creditId,bytes header,bytes proof)",
  "function confirmSolanaRecoveryReturn(bytes32 creditId,bytes header,bytes proof)",
  "function cancelExpiredSolanaRecoveryReturn(bytes32 creditId,bytes header,bytes proof)",
  "function reconcileSolanaRecoveryRefund(bytes32 creditId,uint256 cumulativeRefunded,bytes header,bytes proof)",
]);
const verifierAbi = parseAbi([
  "function verifySolanaFunding(bytes header,bytes proof,bytes32 genesis,bytes32 program,bytes32 programDataHash,bytes32 lockPda,bytes32 recoveryPda,bytes32 creditId,bytes32 actionHash,uint256 nonce) view returns (bool)",
  "function verifySolanaFundingAbsence(bytes header,bytes proof,bytes32 genesis,bytes32 program,bytes32 programDataHash,bytes32 lockPda,bytes32 recoveryPda,bytes32 creditId,bytes32 actionHash,uint256 nonce,uint256 deadline) view returns (bool)",
  "function verifySolanaPayout(bytes header,bytes proof,bytes32 genesis,bytes32 program,bytes32 programDataHash,bytes32 lockPda,bytes32 recoveryPda,bytes32 creditId,bytes32 actionHash,uint256 nonce) view returns (bool)",
  "function verifySolanaPayoutAbsence(bytes header,bytes proof,bytes32 genesis,bytes32 program,bytes32 programDataHash,bytes32 lockPda,bytes32 recoveryPda,bytes32 creditId,bytes32 actionHash,uint256 nonce,uint256 deadline) view returns (bool)",
  "function verifySolanaRefund(bytes header,bytes proof,bytes32 genesis,bytes32 program,bytes32 programDataHash,bytes32 lockPda,bytes32 recoveryPda,bytes32 creditId,uint256 cumulativeRefunded) view returns (bool)",
]);
const factoryAbi = parseAbi([
  "function inboxOf(bytes32) view returns (address)",
  "function operationDigestOf(bytes32) view returns (bytes32)",
]);
const eventTopic = keccak256(stringToHex(
  "SolanaRecoveryFundAuthorized(bytes32,bytes32,bytes32,address,bytes32,uint256,bytes32,uint256,uint256,uint256)",
));
const eventData = [
  { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" },
  { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
] as const;
const domain = keccak256(stringToHex("Termbook Solana recovery fund v1"));
const word = /^0x[0-9a-fA-F]{64}$/;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const maxU64 = (1n << 64n) - 1n;
const maxI64 = (1n << 63n) - 1n;

type FundingEvent = {
  actionHash: Hex; inbox: Address; depositPubkey: Hex; amount: bigint;
  quoteHash: Hex; nonce: bigint; revision: bigint; deadline: bigint;
};

function field(value: unknown, key: string, index: number): unknown {
  return Array.isArray(value) ? value[index]
    : value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function same(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function exactFundingLog(receipt: TransactionReceipt, core: Address, creditId: Hex, operationId: Hex):
  { index: number; event: FundingEvent } {
  if (receipt.status !== "success") throw new Error("solana-funding-receipt-invalid");
  const matches = receipt.logs.flatMap((log, index) => {
    if (!same(log.address, core) || log.topics.length !== 4 || !same(log.topics[0], eventTopic)
      || !same(log.topics[1], creditId) || !same(log.topics[2], operationId)
      || !word.test(log.topics[3] ?? "") || log.data.length !== 2 + 7 * 64) return [];
    const [inbox, depositPubkey, amount, quoteHash, nonce, revision, deadline] =
      decodeAbiParameters(eventData, log.data);
    return [{ index, event: { actionHash: log.topics[3]!, inbox, depositPubkey,
      amount, quoteHash, nonce, revision, deadline } }];
  });
  if (matches.length !== 1) throw new Error("solana-funding-log-mismatch");
  return matches[0]!;
}

function hashFunding(input: {
  monadChain: bigint; monadCore: Address; sourceGenesis: Hex; programId: Hex;
  recoveryVault: Hex; creditId: Hex; asset: Hex; operationId: Hex;
  operationDigest: Hex; inbox: Address; depositPubkey: Hex; amountLamports: bigint;
  quoteHash: Hex; nonce: bigint; revision: bigint; deadline: bigint;
}): Hex {
  const number = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
  const account = (value: Address) => `0x${value.slice(2).padStart(64, "0")}` as Hex;
  return keccak256(concatHex([
    domain, number(input.monadChain), account(input.monadCore), input.sourceGenesis,
    input.programId, input.recoveryVault, input.creditId, input.asset,
    input.operationId, input.operationDigest, account(input.inbox), input.depositPubkey,
    number(input.amountLamports), input.quoteHash, number(input.nonce),
    number(input.revision), number(input.deadline),
  ]));
}

export const solanaRecoveryService = {
  async fundingPlan(input: z.infer<typeof solanaRecoveryFundingPlanSchema>, requester: string) {
    const chain = monadClient();
    if (await chain.getChainId() !== env.monadChainId) throw new Error("solana-monad-chain-mismatch");
    const at = (await chain.getBlock({ blockTag: "finalized" })).number;
    const core = env.core as Address;
    if (!await chain.readContract({ address: core, abi: coreAbi, functionName: "recoveryKeepers",
      args: [requester as Address], blockNumber: at })) throw new Error("permission-denied");
    const receipt = await chain.getTransactionReceipt({ hash: input.authorizationTxHash });
    if (receipt.blockNumber > at) throw new Error("solana-funding-not-finalized");
    const authorized = exactFundingLog(receipt, core, input.creditId, input.operationId).event;
    const [credit, debt, isSolana, identity, lockPda, sourceChain, funded, confirmed, factory, factoryHash,
      pendingHash, pendingOperation, pendingAmount, pendingNonce, pendingDeadline] =
      await Promise.all([
        chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDebt",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "solanaCollateral",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "solanaIdentityOf",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "solanaLockPdaOf",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "collateralSourceChainOf",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "solanaRecoveryOperationFunded",
          args: [input.operationId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "remoteSeizureConfirmed",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "solanaRecoveryFactory",
          blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "solanaRecoveryFactoryCodeHash",
          blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaFundingHash",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaFundingOperation",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaFundingAmount",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaFundingNonce",
          args: [input.creditId], blockNumber: at }),
        chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaFundingDeadline",
          args: [input.creditId], blockNumber: at }),
      ]);
    if (!isSolana || !funded || !confirmed || debt <= 0n || sourceChain <= 0n
      || !same(pendingHash, authorized.actionHash) || !same(pendingOperation, input.operationId)
      || pendingAmount !== authorized.amount || pendingNonce !== authorized.nonce
      || pendingDeadline !== authorized.deadline
      || !word.test(credit.lockId) || BigInt(credit.lockId) === 0n
      || !word.test(lockPda) || BigInt(lockPda) === 0n
      || factory === zeroAddress || !word.test(factoryHash) || BigInt(factoryHash) === 0n
      || authorized.amount <= 0n || authorized.amount > maxU64
      || authorized.nonce <= 0n || authorized.nonce > maxU64
      || authorized.revision <= 0n || authorized.revision > maxU64
      || authorized.deadline <= 0n || authorized.deadline > maxI64
      || authorized.deadline * 1000n <= BigInt(Date.now() + 120_000)
      || !word.test(authorized.actionHash) || BigInt(authorized.actionHash) === 0n
      || !word.test(authorized.depositPubkey) || BigInt(authorized.depositPubkey) === 0n
      || !word.test(authorized.quoteHash) || BigInt(authorized.quoteHash) === 0n) {
      throw new Error("solana-funding-unavailable");
    }
    const runtime = await chain.getCode({ address: factory, blockNumber: at });
    if (!runtime || !same(keccak256(runtime), factoryHash)) throw new Error("solana-funding-factory-mismatch");
    const [inbox, operationDigest, market] = await Promise.all([
      chain.readContract({ address: factory, abi: factoryAbi, functionName: "inboxOf",
        args: [input.operationId], blockNumber: at }),
      chain.readContract({ address: factory, abi: factoryAbi, functionName: "operationDigestOf",
        args: [input.operationId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaMarkets",
        args: [sourceChain], blockNumber: at }),
    ]);
    const genesis = field(identity, "sourceGenesis", 0) as Hex;
    const programId = field(identity, "programId", 1) as Hex;
    const asset = field(identity, "sourceAsset", 2) as Hex;
    const recoveryVault = field(identity, "recoveryVault", 5) as Hex;
    const programDataHash = field(market, "programDataHash", 2);
    if (![genesis, programId, asset, recoveryVault, operationDigest].every((value) => word.test(value)
      && BigInt(value) !== 0n)
      || !same(asset, NATIVE_SOL_ASSET_BYTES)
      || !same(credit.collateralVault, solanaAlias(genesis, programId))
      || !same(credit.collateralAsset, solanaAlias(genesis, asset))
      || !same(inbox, authorized.inbox)
      || !same(field(market, "sourceGenesis", 0), genesis)
      || !same(field(market, "programId", 1), programId)
      || !same(field(market, "sourceAsset", 3), asset)
      || typeof programDataHash !== "string" || !word.test(programDataHash)
      || BigInt(programDataHash) === 0n
      || [recoveryVault, lockPda].some((value) => same(value, authorized.depositPubkey))) {
      throw new Error("solana-funding-binding-mismatch");
    }
    const funding = {
      monadChain: BigInt(env.monadChainId), monadCore: core, sourceGenesis: genesis,
      programId, lockPda, recoveryVault, creditId: input.creditId, lockId: credit.lockId,
      asset, operationId: input.operationId, operationDigest, inbox: authorized.inbox,
      depositPubkey: authorized.depositPubkey, amountLamports: authorized.amount,
      quoteHash: authorized.quoteHash, nonce: authorized.nonce,
      revision: authorized.revision, deadline: authorized.deadline,
    };
    const localHash = hashFunding(funding);
    const onchainHash = await chain.readContract({ address: core, abi: coreAbi,
      functionName: "solanaRecoveryFundHash", args: [{ creditId: input.creditId,
        operationId: input.operationId, inbox: authorized.inbox,
        depositPubkey: authorized.depositPubkey, amount: authorized.amount,
        quoteHash: authorized.quoteHash, deadline: authorized.deadline }, operationDigest,
      authorized.nonce, authorized.revision], blockNumber: at });
    if (!same(localHash, authorized.actionHash) || !same(onchainHash, authorized.actionHash)) {
      throw new Error("solana-funding-hash-mismatch");
    }
    const registration = await settlementRepo.get(input.operationId);
    if (!registration || registration.kind !== "recovery"
      || registration.sourceChain !== Number(sourceChain)
      || !same(registration.sourceAsset, credit.collateralAsset)
      || !same(registration.inbox, authorized.inbox)
      || registration.maxAmountIn !== authorized.amount.toString()
      || typeof registration.sourceRefundRecipient !== "string") {
      throw new Error("solana-funding-quote-mismatch");
    }
    const signed = registration.quote as OneClickQuoteResponse | undefined;
    const quoteDeadline = Date.parse(signed?.quote?.deadline ?? "");
    let depositPubkey: Hex;
    let refundPubkey: Hex;
    try {
      if (!signed?.quote.depositAddress || !signed.quote.deadline
        || !verifyQuoteSignature(signed)) throw new Error();
      depositPubkey = solanaBase58Bytes(signed.quote.depositAddress);
      refundPubkey = solanaBase58Bytes(registration.sourceRefundRecipient);
    } catch {
      throw new Error("solana-funding-quote-mismatch");
    }
    if (!same(depositPubkey, authorized.depositPubkey)
      || !same(refundPubkey, recoveryVault)
      || !same(keccak256(stringToHex(quoteHash(signed))), authorized.quoteHash)
      || !same(signed.quoteRequest.recipient, authorized.inbox)
      || signed.quoteRequest.refundTo !== registration.sourceRefundRecipient
      || signed.quoteRequest.amount !== authorized.amount.toString()
      || signed.quote.amountIn !== authorized.amount.toString()
      || !Number.isFinite(quoteDeadline) || quoteDeadline <= Date.now()
      || quoteDeadline < Number(authorized.deadline) * 1000) {
      throw new Error("solana-funding-quote-mismatch");
    }
    return {
      fundingHash: authorized.actionHash, programDataHash,
      authorizationTxHash: input.authorizationTxHash,
      funding: Object.fromEntries(Object.entries(funding).map(([key, value]) =>
        [key, typeof value === "bigint" ? value.toString() : value])),
    };
  },
  async confirmationPlan(
    input: z.infer<typeof solanaRecoveryFundingConfirmationSchema>
      | z.infer<typeof solanaRecoveryPayoutConfirmationSchema>,
    requester: string, purpose: "funding" | "payout" = "funding",
  ) {
    const rpcUrl = process.env["SOLANA_RPC_URL"];
    const proofUrl = process.env["SOLANA_PROOF_URL"];
    if (!rpcUrl || !proofUrl) throw new Error("solana-funding-proof-unavailable");
    const chain = monadClient();
    if (await chain.getChainId() !== env.monadChainId) throw new Error("solana-monad-chain-mismatch");
    const at = (await chain.getBlock({ blockTag: "finalized" })).number;
    const core = env.core as Address;
    const [credit, isSolana, identity, lockPda, sourceChain, hash, operation,
      nonce, deadline, registry] = await Promise.all([
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaCollateral",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaIdentityOf",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaLockPdaOf",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "collateralSourceChainOf",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi,
        functionName: purpose === "funding" ? "pendingSolanaFundingHash" : "pendingSolanaPayoutHash",
        args: [input.creditId], blockNumber: at }),
      purpose === "funding"
        ? chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaFundingOperation",
          args: [input.creditId], blockNumber: at })
        : Promise.resolve(undefined),
      chain.readContract({ address: core, abi: coreAbi,
        functionName: purpose === "funding" ? "pendingSolanaFundingNonce" : "pendingSolanaPayoutNonce",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi,
        functionName: purpose === "funding" ? "pendingSolanaFundingDeadline" : "pendingSolanaPayoutDeadline",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "verifierRegistry",
        blockNumber: at }),
    ]);
    if (!isSolana || sourceChain <= 0n || !word.test(hash) || BigInt(hash) === 0n
      || (purpose === "funding" && (!('operationId' in input) || !same(operation, input.operationId)))
      || nonce <= 0n || deadline <= 0n
      || !word.test(lockPda) || BigInt(lockPda) === 0n || registry === zeroAddress) {
      throw new Error("solana-funding-unavailable");
    }
    const genesis = field(identity, "sourceGenesis", 0) as Hex;
    const programId = field(identity, "programId", 1) as Hex;
    const recoveryVault = field(identity, "recoveryVault", 5) as Hex;
    const [market, pinned] = await Promise.all([
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaMarkets",
        args: [sourceChain], blockNumber: at }),
      chain.readContract({ address: registry, abi: verifierRegistryAbi, functionName: "verifiers",
        args: [sourceChain], blockNumber: at }),
    ]);
    const programDataHash = field(market, "programDataHash", 2) as Hex;
    if (![genesis, programId, recoveryVault, programDataHash].every((value) => word.test(value)
      && BigInt(value) !== 0n)
      || !same(field(market, "sourceGenesis", 0), genesis)
      || !same(field(market, "programId", 1), programId)
      || !same(credit.collateralVault, solanaAlias(genesis, programId))) {
      throw new Error("solana-funding-binding-mismatch");
    }
    const [verifier, version, active, , codeHash] = pinned;
    if (!active || verifier === zeroAddress || version !== credit.verifierVersion
      || !same(codeHash, credit.verifierCodeHash)) throw new Error("solana-verifier-unavailable");
    const runtime = await chain.getCode({ address: verifier, blockNumber: at });
    if (!runtime || !same(keccak256(runtime), codeHash)) throw new Error("solana-verifier-code-mismatch");
    const proof = await fetchSolanaProof({ rpcUrl, proofUrl, kind: "recovery",
      digest: hash, genesis, programId, programDataHash, lockPda,
      accountPda: recoveryVault, sourceTx: input.sourceTx });
    const verified = input.mode === "confirm"
      ? await chain.readContract({ address: verifier, abi: verifierAbi,
        functionName: purpose === "funding" ? "verifySolanaFunding" : "verifySolanaPayout",
        args: [proof.header, proof.proof, genesis, programId, programDataHash,
          lockPda, recoveryVault, input.creditId, hash, nonce], blockNumber: at })
      : await chain.readContract({ address: verifier, abi: verifierAbi,
        functionName: purpose === "funding" ? "verifySolanaFundingAbsence" : "verifySolanaPayoutAbsence",
        args: [proof.header, proof.proof, genesis, programId, programDataHash,
          lockPda, recoveryVault, input.creditId, hash, nonce, deadline], blockNumber: at });
    if (!verified) throw new Error(`solana-${purpose}-proof-rejected`);
    const functionName = purpose === "funding"
      ? input.mode === "confirm" ? "confirmSolanaRecoveryFund" : "cancelExpiredSolanaRecoveryFund"
      : input.mode === "confirm" ? "confirmSolanaRecoveryReturn" : "cancelExpiredSolanaRecoveryReturn";
    const data = encodeFunctionData({ abi: coreAbi, functionName,
      args: [input.creditId, proof.header, proof.proof] });
    await chain.call({ account: requester as Address, to: core, data });
    return { to: core, data, actionHash: hash, operationId: operation,
      sourceSlot: proof.slot, sourceBlockhash: proof.blockhash, mode: input.mode, purpose };
  },
  async refundReconciliationPlan(
    input: z.infer<typeof solanaRecoveryRefundReconciliationSchema>, requester: string,
  ) {
    const rpcUrl = process.env["SOLANA_RPC_URL"];
    const proofUrl = process.env["SOLANA_PROOF_URL"];
    if (!rpcUrl || !proofUrl) throw new Error("solana-refund-proof-unavailable");
    const cumulative = BigInt(input.cumulativeRefunded);
    if (cumulative > maxU64) throw new Error("solana-refund-invalid");
    const chain = monadClient();
    if (await chain.getChainId() !== env.monadChainId) throw new Error("solana-monad-chain-mismatch");
    const at = (await chain.getBlock({ blockTag: "finalized" })).number;
    const core = env.core as Address;
    const [credit, isSolana, identity, lockPda, sourceChain, previous, registry] = await Promise.all([
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaCollateral",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaIdentityOf",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaLockPdaOf",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "collateralSourceChainOf",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaRecoveryRefunded",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "verifierRegistry",
        blockNumber: at }),
    ]);
    if (!isSolana || sourceChain <= 0n || cumulative <= previous
      || !word.test(lockPda) || BigInt(lockPda) === 0n || registry === zeroAddress) {
      throw new Error("solana-refund-unavailable");
    }
    const genesis = field(identity, "sourceGenesis", 0) as Hex;
    const programId = field(identity, "programId", 1) as Hex;
    const recoveryVault = field(identity, "recoveryVault", 5) as Hex;
    const [market, pinned] = await Promise.all([
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaMarkets",
        args: [sourceChain], blockNumber: at }),
      chain.readContract({ address: registry, abi: verifierRegistryAbi, functionName: "verifiers",
        args: [sourceChain], blockNumber: at }),
    ]);
    const programDataHash = field(market, "programDataHash", 2) as Hex;
    if (![genesis, programId, recoveryVault, programDataHash].every((value) => word.test(value)
      && BigInt(value) !== 0n)
      || !same(field(market, "sourceGenesis", 0), genesis)
      || !same(field(market, "programId", 1), programId)
      || !same(credit.collateralVault, solanaAlias(genesis, programId))) {
      throw new Error("solana-refund-binding-mismatch");
    }
    const [verifier, version, active, , codeHash] = pinned;
    if (!active || verifier === zeroAddress || version !== credit.verifierVersion
      || !same(codeHash, credit.verifierCodeHash)) throw new Error("solana-verifier-unavailable");
    const runtime = await chain.getCode({ address: verifier, blockNumber: at });
    if (!runtime || !same(keccak256(runtime), codeHash)) throw new Error("solana-verifier-code-mismatch");
    const proof = await fetchSolanaProof({ rpcUrl, proofUrl, kind: "recovery",
      digest: input.creditId, genesis, programId, programDataHash, lockPda,
      accountPda: recoveryVault, sourceTx: input.sourceTx });
    const verified = await chain.readContract({ address: verifier, abi: verifierAbi,
      functionName: "verifySolanaRefund", args: [proof.header, proof.proof, genesis,
        programId, programDataHash, lockPda, recoveryVault, input.creditId, cumulative], blockNumber: at });
    if (!verified) throw new Error("solana-refund-proof-rejected");
    const data = encodeFunctionData({ abi: coreAbi, functionName: "reconcileSolanaRecoveryRefund",
      args: [input.creditId, cumulative, proof.header, proof.proof] });
    await chain.call({ account: requester as Address, to: core, data });
    return { to: core, data, creditId: input.creditId, cumulativeRefunded: cumulative.toString(),
      sourceSlot: proof.slot, sourceBlockhash: proof.blockhash };
  },
};
