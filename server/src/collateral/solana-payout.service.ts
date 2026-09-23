import { termbookCoreAbi } from "@termbook/bindings";
import { NATIVE_SOL_ASSET_BYTES } from "@termbook/schema";
import { concatHex, decodeAbiParameters, keccak256, parseAbi, stringToHex,
  type Address, type Hex, type TransactionReceipt } from "viem";
import { fetchMonadReceiptProof } from "../chain/monad-receipt-proof.js";
import { monadClient } from "../chain/monad.client.js";
import { env } from "../config/env.js";
import { solanaAlias } from "../quote/solana.js";
import type { z } from "zod";
import type { solanaRecoveryPayoutPlanSchema } from "./solana-payout.schema.js";

const coreAbi = parseAbi([
  "function solanaCollateral(bytes32) view returns (bool)",
  "function remoteSeizureConfirmed(bytes32) view returns (bool)",
  "function solanaIdentityOf(bytes32) view returns (bytes32 sourceGenesis,bytes32 programId,bytes32 sourceAsset,bytes32 sourceOwner,bytes32 returnRecipient,bytes32 recoveryVault,uint64 verifierVersion)",
  "function solanaLockPdaOf(bytes32) view returns (bytes32)",
  "function collateralSourceChainOf(bytes32) view returns (uint256)",
  "function solanaMarkets(uint256) view returns (bytes32 sourceGenesis,bytes32 programId,bytes32 programDataHash,bytes32 sourceAsset,bool active)",
  "function pendingSolanaPayoutHash(bytes32) view returns (bytes32)",
  "function pendingSolanaPayoutAmount(bytes32) view returns (uint256)",
  "function pendingSolanaPayoutNonce(bytes32) view returns (uint256)",
  "function pendingSolanaPayoutDeadline(bytes32) view returns (uint256)",
  "function solanaRecoveryReturnHash(bytes32 creditId,uint256 amount,uint256 nonce,uint256 revision,uint256 deadline) view returns (bytes32)",
]);
const eventTopic = keccak256(stringToHex(
  "SolanaRecoveryReturnAuthorized(bytes32,bytes32,bytes32,uint256,uint256,uint256,uint256)",
));
const domain = keccak256(stringToHex("Termbook Solana recovery payout v1"));
const word = /^0x[0-9a-fA-F]{64}$/;
const maxU64 = (1n << 64n) - 1n;
const maxI64 = (1n << 63n) - 1n;

type PayoutEvent = {
  hash: Hex; recipient: Hex; amount: bigint; nonce: bigint; revision: bigint; deadline: bigint;
};

function field(value: unknown, key: string, index: number): unknown {
  return Array.isArray(value) ? value[index]
    : value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function same(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function exactPayoutLog(receipt: TransactionReceipt, core: Address, creditId: Hex):
  { index: number; event: PayoutEvent } {
  if (receipt.status !== "success") throw new Error("solana-payout-receipt-invalid");
  const matches = receipt.logs.flatMap((log, index) => {
    if (!same(log.address, core) || log.topics.length !== 4 || !same(log.topics[0], eventTopic)
      || !same(log.topics[1], creditId) || !word.test(log.topics[2] ?? "")
      || !word.test(log.topics[3] ?? "") || log.data.length !== 2 + 4 * 64) return [];
    const [amount, nonce, revision, deadline] = decodeAbiParameters([
      { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
    ], log.data);
    return [{ index, event: { hash: log.topics[2]!, recipient: log.topics[3]!,
      amount, nonce, revision, deadline } }];
  });
  if (matches.length !== 1) throw new Error("solana-payout-log-mismatch");
  return matches[0]!;
}

function hashPayout(input: {
  monadChain: bigint; monadCore: Address; sourceGenesis: Hex; programId: Hex;
  recoveryVault: Hex; creditId: Hex; asset: Hex; recipient: Hex;
  amountLamports: bigint; nonce: bigint; revision: bigint; deadline: bigint;
}): Hex {
  const number = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
  const account = `0x${input.monadCore.slice(2).padStart(64, "0")}` as Hex;
  return keccak256(concatHex([
    domain, number(input.monadChain), account, input.sourceGenesis,
    input.programId, input.recoveryVault, input.creditId, input.asset,
    input.recipient, number(input.amountLamports), number(input.nonce),
    number(input.revision), number(input.deadline),
  ]));
}

export const solanaPayoutService = {
  async plan(input: z.infer<typeof solanaRecoveryPayoutPlanSchema>, requester: string) {
    if (!env.monadProofUrl) throw new Error("solana-payout-proof-unavailable");
    const chain = monadClient();
    if (await chain.getChainId() !== env.monadChainId) throw new Error("solana-monad-chain-mismatch");
    const at = (await chain.getBlock({ blockTag: "finalized" })).number;
    const core = env.core as Address;
    let event: PayoutEvent | undefined;
    const proof = await fetchMonadReceiptProof({ txHash: input.authorizationTxHash,
      finalityUrl: env.monadProofUrl,
      selectLog(receipt) {
        const selected = exactPayoutLog(receipt, core, input.creditId);
        event = selected.event;
        return selected.index;
      },
    });
    if (!event) throw new Error("solana-payout-log-mismatch");
    const authorized = event;
    const [credit, debt, isSolana, confirmed, identity, lockPda, sourceChain,
      pendingHash, pendingAmount, pendingNonce, pendingDeadline] = await Promise.all([
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDetails",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: termbookCoreAbi, functionName: "creditDebt",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaCollateral",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "remoteSeizureConfirmed",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaIdentityOf",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "solanaLockPdaOf",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "collateralSourceChainOf",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaPayoutHash",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaPayoutAmount",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaPayoutNonce",
        args: [input.creditId], blockNumber: at }),
      chain.readContract({ address: core, abi: coreAbi, functionName: "pendingSolanaPayoutDeadline",
        args: [input.creditId], blockNumber: at }),
    ]);
    if (!isSolana || !confirmed || debt !== 0n || !same(credit.borrower, requester)
      || sourceChain <= 0n || !word.test(credit.lockId) || BigInt(credit.lockId) === 0n
      || !word.test(lockPda) || BigInt(lockPda) === 0n
      || !same(pendingHash, authorized.hash) || pendingAmount !== authorized.amount
      || pendingNonce !== authorized.nonce || pendingDeadline !== authorized.deadline
      || authorized.amount <= 0n || authorized.amount > maxU64
      || authorized.nonce <= 0n || authorized.nonce > maxU64
      || authorized.revision <= 0n || authorized.revision > maxU64
      || authorized.deadline <= 0n || authorized.deadline > maxI64
      || authorized.deadline * 1000n <= BigInt(Date.now() + 120_000)) {
      throw new Error("solana-payout-unavailable");
    }
    const genesis = field(identity, "sourceGenesis", 0) as Hex;
    const programId = field(identity, "programId", 1) as Hex;
    const asset = field(identity, "sourceAsset", 2) as Hex;
    const recipient = field(identity, "returnRecipient", 4) as Hex;
    const recoveryVault = field(identity, "recoveryVault", 5) as Hex;
    const market = await chain.readContract({ address: core, abi: coreAbi, functionName: "solanaMarkets",
      args: [sourceChain], blockNumber: at });
    const programDataHash = field(market, "programDataHash", 2);
    if (![genesis, programId, asset, recipient, recoveryVault].every((value) => word.test(value)
      && BigInt(value) !== 0n)
      || !same(asset, NATIVE_SOL_ASSET_BYTES)
      || !same(recipient, authorized.recipient)
      || !same(credit.collateralVault, solanaAlias(genesis, programId))
      || !same(credit.collateralAsset, solanaAlias(genesis, asset))
      || !same(credit.returnRecipient, solanaAlias(genesis, recipient))
      || !same(field(market, "sourceGenesis", 0), genesis)
      || !same(field(market, "programId", 1), programId)
      || !same(field(market, "sourceAsset", 3), asset)
      || typeof programDataHash !== "string" || !word.test(programDataHash)
      || BigInt(programDataHash) === 0n) {
      throw new Error("solana-payout-binding-mismatch");
    }
    const payout = {
      monadChain: BigInt(env.monadChainId), monadCore: core, sourceGenesis: genesis,
      programId, lockPda, recoveryVault, creditId: input.creditId, lockId: credit.lockId,
      asset, recipient, amountLamports: authorized.amount, nonce: authorized.nonce,
      revision: authorized.revision, deadline: authorized.deadline,
    };
    const localHash = hashPayout(payout);
    const onchainHash = await chain.readContract({ address: core, abi: coreAbi,
      functionName: "solanaRecoveryReturnHash", args: [input.creditId, authorized.amount,
        authorized.nonce, authorized.revision, authorized.deadline], blockNumber: at });
    if (!same(localHash, authorized.hash) || !same(onchainHash, authorized.hash)) {
      throw new Error("solana-payout-hash-mismatch");
    }
    if ((proof.header.length + proof.proof.length - 4) / 2 + 73 > 1_000) {
      throw new Error("solana-authorization-proof-too-large");
    }
    return { payoutHash: authorized.hash, programDataHash, header: proof.header,
      proof: proof.proof, payout: Object.fromEntries(Object.entries(payout).map(([key, value]) =>
        [key, typeof value === "bigint" ? value.toString() : value])) };
  },
};
