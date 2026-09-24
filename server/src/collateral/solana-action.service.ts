import { termbookCoreAbi, verifierRegistryAbi } from "@termbook/bindings";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { solanaAlias } from "../quote/solana.js";
import { fetchSolanaProof, solanaFinalizedClock } from "./solana-proof.js";
import type { z } from "zod";
import type { solanaActionPlanSchema, solanaConfirmationPlanSchema } from "./solana-action.schema.js";

const coreAbi = parseAbi([
  "function solanaCollateral(bytes32) view returns (bool)",
  "function collateralSourceChainOf(bytes32) view returns (uint256)",
  "function solanaIdentityOf(bytes32) view returns (bytes32 sourceGenesis,bytes32 programId,bytes32 sourceAsset,bytes32 sourceOwner,bytes32 returnRecipient,bytes32 recoveryVault,uint64 verifierVersion)",
  "function solanaLockPdaOf(bytes32) view returns (bytes32)",
  "function solanaMarkets(uint256) view returns (bytes32 sourceGenesis,bytes32 programId,bytes32 programDataHash,bytes32 sourceAsset,bool active)",
  "function remoteActionNonce(bytes32) view returns (uint256)",
  "function pendingRemoteReturn(bytes32) view returns (uint256)",
  "function remoteReturnActionHash(bytes32) view returns (bytes32)",
  "function remoteReturnRevision(bytes32) view returns (uint256)",
  "function remoteReturnDeadline(bytes32) view returns (uint256)",
  "function pendingRemoteSeizure(bytes32) view returns (uint256)",
  "function remoteSeizureActionHash(bytes32) view returns (bytes32)",
  "function remoteSeizureRevision(bytes32) view returns (uint256)",
  "function remoteSeizureDeadline(bytes32) view returns (uint256)",
  "function remoteSeizureRecipient(bytes32) view returns (address)",
  "function recoveryKeepers(address) view returns (bool)",
  "function solanaActionHash(bytes32,uint8,uint256,uint256,uint256,uint256) view returns (bytes32)",
  "function confirmRemoteReturn(bytes32 creditId,bytes header,bytes proof)",
  "function confirmRemoteSeizure(bytes32 creditId,bytes header,bytes proof)",
  "function cancelExpiredRemoteReturn(bytes32 creditId,bytes header,bytes proof)",
  "function cancelExpiredRemoteSeizure(bytes32 creditId,bytes header,bytes proof)",
]);
const verifierAbi = parseAbi([
  "function verifySolanaAction(bytes header,bytes proof,bytes32 sourceGenesis,bytes32 programId,bytes32 programDataHash,bytes32 lockPda,bytes32 actionDigest) view returns (bool)",
  "function verifySolanaCancellation(bytes header,bytes proof,bytes32 sourceGenesis,bytes32 programId,bytes32 programDataHash,bytes32 lockPda,bytes32 actionHash,uint256 nonce,uint256 deadline) view returns (bool)",
]);

const domain = keccak256(stringToHex("Termbook Solana action v1"));
const word = /^0x[0-9a-fA-F]{64}$/;
const maxU64 = (1n << 64n) - 1n;
const maxI64 = (1n << 63n) - 1n;

function field(value: unknown, key: string, index: number): unknown {
  return Array.isArray(value) ? value[index]
    : value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function same(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

export type SolanaAction = {
  monadChain: bigint; monadCore: Address; sourceGenesis: Hex; sourceVault: Hex;
  creditId: Hex; lockId: Hex; asset: Hex; kind: 0 | 1; recipient: Hex;
  amountLamports: bigint; nonce: bigint; revision: bigint; deadline: bigint;
  verifierVersion: bigint;
};

export function hashSolanaAction(action: SolanaAction, programId: Hex): Hex {
  if (![action.sourceGenesis, action.sourceVault, action.creditId, action.lockId,
    action.asset, action.recipient, programId].every((value) => word.test(value) && BigInt(value) !== 0n)
    || [action.monadChain, action.amountLamports, action.nonce, action.revision,
      action.deadline, action.verifierVersion].some((value) => value <= 0n || value > maxU64)
    || action.deadline > maxI64 || (action.kind !== 0 && action.kind !== 1)) {
    throw new Error("solana-action-invalid");
  }
  return keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" },
    { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
    { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
    { type: "uint8" }, { type: "bytes32" }, { type: "uint256" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
  ], [domain, action.monadChain, action.monadCore, action.sourceGenesis, programId,
    action.sourceVault, action.creditId, action.lockId, action.asset, action.kind,
    action.recipient, action.amountLamports, action.nonce, action.revision,
    action.deadline, action.verifierVersion]));
}

type PlanInput = z.infer<typeof solanaActionPlanSchema>;
type ConfirmationInput = z.infer<typeof solanaConfirmationPlanSchema>;
const zeroAddress = "0x0000000000000000000000000000000000000000";

export async function readSolanaAction(input: Pick<PlanInput, "creditId" | "kind">, requester: string) {
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new Error("solana-monad-chain-mismatch");
  const at = (await chain.getBlock({ blockTag: "finalized" })).number;
  const core = env.core as Address;
  const kind = input.kind === "release" ? 0 : 1;
  const [credit, isSolana, sourceChain, identity, pda, nonce, amount, actionHash, revision, deadline] = await Promise.all([
    chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails", args: [input.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "solanaCollateral", args: [input.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "collateralSourceChainOf", args: [input.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "solanaIdentityOf", args: [input.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "solanaLockPdaOf", args: [input.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi, functionName: "remoteActionNonce", args: [input.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi,
      functionName: kind === 0 ? "pendingRemoteReturn" : "pendingRemoteSeizure", args: [input.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi,
      functionName: kind === 0 ? "remoteReturnActionHash" : "remoteSeizureActionHash", args: [input.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi,
      functionName: kind === 0 ? "remoteReturnRevision" : "remoteSeizureRevision", args: [input.creditId], blockNumber: at }),
    chain.readContract({ address: core, abi: coreAbi,
      functionName: kind === 0 ? "remoteReturnDeadline" : "remoteSeizureDeadline", args: [input.creditId], blockNumber: at }),
  ]);
  if (!isSolana || sourceChain <= 0n || amount <= 0n || nonce <= 0n || revision <= 0n || deadline <= 0n
    || !word.test(pda) || BigInt(pda) === 0n || !word.test(actionHash) || BigInt(actionHash) === 0n
    || !word.test(credit.lockId) || BigInt(credit.lockId) === 0n) throw new Error("solana-action-unavailable");
  const allowed = kind === 0 ? same(credit.borrower, requester)
    : await chain.readContract({ address: core, abi: coreAbi, functionName: "recoveryKeepers",
      args: [requester as Address], blockNumber: at });
  if (!allowed) throw new Error("permission-denied");
  const genesis = field(identity, "sourceGenesis", 0) as Hex;
  const programId = field(identity, "programId", 1) as Hex;
  const asset = field(identity, "sourceAsset", 2) as Hex;
  const recipient = field(identity, kind === 0 ? "returnRecipient" : "recoveryVault", kind === 0 ? 4 : 5) as Hex;
  const verifierVersion = BigInt(String(field(identity, "verifierVersion", 6)));
  if ([genesis, programId, asset, recipient].some((value) => !word.test(value) || BigInt(value) === 0n)
    || !same(credit.collateralVault, solanaAlias(genesis, programId))
    || !same(credit.collateralAsset, solanaAlias(genesis, asset))
    || !same(credit.returnRecipient, solanaAlias(genesis, field(identity, "returnRecipient", 4) as Hex))) {
    throw new Error("solana-action-binding-mismatch");
  }
  const market = await chain.readContract({ address: core, abi: coreAbi, functionName: "solanaMarkets",
    args: [sourceChain], blockNumber: at });
  const programDataHash = field(market, "programDataHash", 2);
  if (!same(field(market, "sourceGenesis", 0), genesis)
    || !same(field(market, "programId", 1), programId)
    || typeof programDataHash !== "string" || !word.test(programDataHash) || BigInt(programDataHash) === 0n
    || !same(field(market, "sourceAsset", 3), asset)) {
    throw new Error("solana-market-unavailable");
  }
  if (kind === 1) {
    const onchainRecipient = await chain.readContract({ address: core, abi: coreAbi,
      functionName: "remoteSeizureRecipient", args: [input.creditId], blockNumber: at });
    if (!same(onchainRecipient, solanaAlias(genesis, recipient))) throw new Error("solana-action-binding-mismatch");
  }
  const action: SolanaAction = {
    monadChain: BigInt(env.monadChainId), monadCore: core, sourceGenesis: genesis,
    sourceVault: pda, creditId: input.creditId, lockId: credit.lockId,
    asset, kind, recipient, amountLamports: amount, nonce, revision,
    deadline, verifierVersion,
  };
  const expected = hashSolanaAction(action, programId);
  const onchain = await chain.readContract({ address: core, abi: coreAbi, functionName: "solanaActionHash",
    args: [input.creditId, kind, amount, nonce, revision, deadline], blockNumber: at });
  if (!same(expected, actionHash) || !same(onchain, actionHash)) throw new Error("solana-action-hash-mismatch");
  return { action, actionHash: actionHash as Hex, programId, programDataHash: programDataHash as Hex,
    credit, sourceChain, pda, at };
}

export const solanaActionService = {
  async plan(input: PlanInput, requester: string) {
    const rpcUrl = process.env["SOLANA_RPC_URL"];
    if (!rpcUrl) throw new Error("solana-action-proof-unavailable");
    const { action, actionHash, programId } = await readSolanaAction(input, requester);
    const timestamp = await solanaFinalizedClock(rpcUrl);
    if (input.mode === "apply" && action.deadline <= BigInt(timestamp + 120)) throw new Error("solana-action-expired");
    if (input.mode === "expire" && action.deadline >= BigInt(timestamp)) throw new Error("solana-action-not-expired");
    return {
      programId, actionHash, mode: input.mode, authorizationTxHash: input.authorizationTxHash,
      action: Object.fromEntries(Object.entries(action).map(([key, value]) =>
        [key, typeof value === "bigint" ? value.toString() : value])),
    };
  },
  async confirmationPlan(input: ConfirmationInput, requester: string) {
    const rpcUrl = process.env["SOLANA_RPC_URL"];
    const proofUrl = process.env["SOLANA_PROOF_URL"];
    if (!rpcUrl || !proofUrl) throw new Error("solana-action-proof-unavailable");
    const { action, actionHash, programId, programDataHash, credit, sourceChain, pda, at } =
      await readSolanaAction(input, requester);
    const chain = monadClient();
    const registry = await chain.readContract({ address: env.core as Address, abi: termbookCoreAbi,
      functionName: "verifierRegistry", blockNumber: at });
    if (registry === zeroAddress) throw new Error("solana-verifier-unavailable");
    const [verifier, version, active, , codeHash] = await chain.readContract({
      address: registry, abi: verifierRegistryAbi, functionName: "verifiers", args: [sourceChain], blockNumber: at,
    });
    if (!active || verifier === zeroAddress || version !== credit.verifierVersion
      || !same(codeHash, credit.verifierCodeHash)) throw new Error("solana-verifier-unavailable");
    const runtime = await chain.getCode({ address: verifier, blockNumber: at });
    if (!runtime || !same(keccak256(runtime), codeHash)) throw new Error("solana-verifier-code-mismatch");
    const proof = await fetchSolanaProof({ rpcUrl, proofUrl, kind: "action", id: actionHash,
      digest: actionHash, genesis: action.sourceGenesis, programId, programDataHash, lockPda: pda,
      sourceTx: input.sourceTx });
    const verified = input.mode === "apply"
      ? await chain.readContract({ address: verifier, abi: verifierAbi, functionName: "verifySolanaAction",
        args: [proof.header, proof.proof, action.sourceGenesis, programId, programDataHash, pda, actionHash],
        blockNumber: at })
      : await chain.readContract({ address: verifier, abi: verifierAbi, functionName: "verifySolanaCancellation",
        args: [proof.header, proof.proof, action.sourceGenesis, programId, programDataHash, pda,
          actionHash, action.nonce, action.deadline], blockNumber: at });
    if (!verified) throw new Error("solana-action-proof-rejected");
    const functionName = input.mode === "apply"
      ? action.kind === 0 ? "confirmRemoteReturn" : "confirmRemoteSeizure"
      : action.kind === 0 ? "cancelExpiredRemoteReturn" : "cancelExpiredRemoteSeizure";
    const data = encodeFunctionData({ abi: coreAbi, functionName,
      args: [action.creditId, proof.header, proof.proof] });
    await chain.call({ account: requester as Address, to: env.core as Address, data });
    return { to: env.core, data, actionHash, sourceSlot: proof.slot, sourceBlockhash: proof.blockhash,
      kind: input.kind, mode: input.mode };
  },
};
