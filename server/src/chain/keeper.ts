import { assertKeeperFunding, assertSignedKeeperFunding } from "./keeper-funding.js";
import { createHash } from "node:crypto";
import { createWalletClient, keccak256, TransactionReceiptNotFoundError,
  type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
import { keeperRepo, type PendingTransaction } from "./keeper.repo.js";
import { pacedHttp } from "./rpc.transport.js";
import { env } from "../config/env.js";

export type KeeperResult = "success" | "reverted" | "pending" | "busy";

export async function keeperTransaction(input: {
  client: PublicClient; rpcUrl: string; chainId: number; account: LocalAccount;
  operation: string; to: Address; data: Hex;
  value?: bigint;
  minimumBalance?: bigint;
  testnetConfirmations?: number;
  testnetFinality?: "safe";
}): Promise<KeeperResult> {
  const { client, account, chainId } = input;
  if (await client.getChainId() !== chainId) throw new Error("keeper-chain-mismatch");
  if (input.testnetConfirmations !== undefined && (chainId !== 11155111 || !Number.isInteger(input.testnetConfirmations)
    || input.testnetConfirmations < 5 || input.testnetConfirmations > 64)) throw new Error("keeper-confirmation-policy-invalid");
  if (input.testnetFinality !== undefined && (chainId !== 84532 || input.testnetFinality !== "safe"
    || input.testnetConfirmations !== undefined)) throw new Error("keeper-confirmation-policy-invalid");
  const key = `${chainId}:${account.address.toLowerCase()}`;
  const id = createHash("sha256").update(`${key}:${input.operation}:${input.to.toLowerCase()}:${input.data}:${input.value ?? 0n}${input.testnetConfirmations === undefined ? "" : `:confirmations:${input.testnetConfirmations}`}${input.testnetFinality ? `:finality:${input.testnetFinality}` : ""}`).digest("hex");
  return withKeeperLease(key, async (claim, assertLease) => {
    const prior = await keeperRepo.result(id);
    if (prior === "success" && !claim.pending) return prior;
    let pending = claim.pending;
    if (!pending) {
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const wallet = createWalletClient({ account, transport: pacedHttp(input.rpcUrl, env.rpcRequestsPerSecond, 2, undefined,
        input.rpcUrl === env.rpcUrl && env.rpcFallbackUrl ? { url: env.rpcFallbackUrl, chainId } : undefined) });
      const request = await wallet.prepareTransactionRequest({ account, chain: null,
        chainId, to: input.to, data: input.data, nonce, value: input.value ?? 0n });
      if ((input.minimumBalance ?? 0n) < 0n) throw new Error("keeper-minimum-balance-invalid");
      await assertKeeperFunding(client, account.address, { ...request, value: (request.value ?? 0n) + (input.minimumBalance ?? 0n) });
      const raw = await wallet.signTransaction({ ...request, account, chain: null });
      pending = { id, hash: keccak256(raw), raw, nonce, to: input.to, data: input.data };
      if (input.minimumBalance !== undefined) pending.minimumBalance = String(input.minimumBalance);
      if (input.testnetConfirmations !== undefined) pending.testnetConfirmations = input.testnetConfirmations;
      if (input.testnetFinality !== undefined) pending.testnetFinality = input.testnetFinality;
      assertLease();
      await keeperRepo.prepared(key, claim.lease, pending);
    }
    const outcome = await reconcile(client, pending);
    assertLease();
    if (outcome) {
      await keeperRepo.completed(key, claim.lease, pending, outcome.status, outcome.block, outcome.blockHash, outcome.hash);
      return pending.id === id ? outcome.status : "busy";
    }
    return "pending";
  });
}

export async function reconcileKeeperWallet(client: PublicClient, chainId: number, address: Address)
  : Promise<KeeperResult | "idle"> {
  if (await client.getChainId() !== chainId) throw new Error("keeper-chain-mismatch");
  const key = `${chainId}:${address.toLowerCase()}`;
  return withKeeperLease(key, async (claim, assertLease) => {
    if (!claim.pending) return "idle";
    const outcome = await reconcile(client, claim.pending);
    assertLease();
    if (!outcome) return "pending";
    await keeperRepo.completed(key, claim.lease, claim.pending,
      outcome.status, outcome.block, outcome.blockHash, outcome.hash);
    return outcome.status;
  });
}

async function withKeeperLease<T>(key: string, run: (
  claim: { lease: string; pending?: PendingTransaction }, assertLease: () => void,
) => Promise<T>): Promise<T | "busy"> {
  const claim = await keeperRepo.claim(key);
  if (!claim) return "busy";
  let lost = false;
  const heartbeat = setInterval(() => {
    void keeperRepo.renew(key, claim.lease).then((ok) => { if (!ok) lost = true; })
      .catch(() => { lost = true; });
  }, 30_000);
  try {
    return await run(claim, () => { if (lost) throw new Error("keeper-lease-lost"); });
  } finally {
    clearInterval(heartbeat);
    await keeperRepo.release(key, claim.lease);
  }
}

async function reconcile(client: PublicClient, pending: PendingTransaction): Promise<{
  status: "success" | "reverted"; block: bigint; blockHash: Hex; hash: Hex;
} | undefined> {
  if (keccak256(pending.raw) !== pending.hash || !Number.isSafeInteger(pending.nonce) || pending.nonce < 0) {
    throw new Error("keeper-journal-invalid");
  }
  const candidates = [{ hash: pending.hash, raw: pending.raw }, ...(pending.previous ?? [])];
  if (candidates.length > 5 || candidates.some((tx) => keccak256(tx.raw) !== tx.hash)) {
    throw new Error("keeper-journal-invalid");
  }
  let receipt;
  for (const tx of candidates) {
    try { receipt = await client.getTransactionReceipt({ hash: tx.hash }); break; }
    catch (error) { if (!(error instanceof TransactionReceiptNotFoundError)) throw error; }
  }
  if (!receipt) {
    try {
      await assertSignedKeeperFunding(client, pending.raw, BigInt(pending.minimumBalance ?? "0"));
      const hash = await client.sendRawTransaction({ serializedTransaction: pending.raw });
      if (hash !== pending.hash) throw new Error("keeper-transaction-hash-mismatch");
    } catch (sendError) {
      if (!(sendError instanceof Error) || !/already known|known transaction|nonce too low/i.test(sendError.message)) {
        throw sendError;
      }
    }
    return undefined;
  }
  const depth = pending.testnetConfirmations;
  if (depth !== undefined && (await client.getChainId() !== 11155111 || !Number.isInteger(depth) || depth < 5 || depth > 64)) {
    throw new Error("keeper-confirmation-policy-invalid");
  }
  if (pending.testnetFinality !== undefined && (await client.getChainId() !== 84532
    || pending.testnetFinality !== "safe" || depth !== undefined)) throw new Error("keeper-confirmation-policy-invalid");
  const finalized = await client.getBlock({ blockTag: pending.testnetFinality ?? (depth === undefined ? "finalized" : "latest") });
  if (depth !== undefined && receipt.blockNumber + BigInt(depth) > finalized.number) return undefined;
  if (receipt.blockNumber > finalized.number) return undefined;
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash || block.transactions[receipt.transactionIndex] !== receipt.transactionHash
    || !candidates.some((tx) => tx.hash === receipt.transactionHash)) throw new Error("keeper-finality-conflict");
  return { status: receipt.status, block: receipt.blockNumber, blockHash: receipt.blockHash, hash: receipt.transactionHash };
}
