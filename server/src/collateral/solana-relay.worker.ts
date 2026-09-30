import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { SolanaJsonRpc, SolanaRpcWallet, parseSolanaActionPlan, submitSolanaAction,
  decodeSolanaLockRecord, solanaPubkeyBase58 } from "@termbook/sdk";
import { termbookCoreAbi } from "@termbook/bindings";
import type { Hex } from "viem";
import { env } from "../config/env.js";
import { monadClient } from "../chain/monad.client.js";
import { keeperTransaction } from "../chain/keeper.js";
import { verifyAuthorizationReceipt } from "./remote-action.service.js";
import { readSolanaAction, solanaActionService } from "./solana-action.service.js";
import { solanaFinalizedClock } from "./solana-proof.js";
import { solanaRelayConfig } from "./solana-relay.config.js";
import { solanaRelayRepo, type RelayAction } from "./solana-relay.repo.js";
import { deliverSolanaRelay, sendSolanaRelay } from "./solana-relay.transaction.js";
import { verifySolanaRelayProgram } from "./solana-relay.program.js";
import { drainQueue, registerHandler } from "../queue/queue.worker.js";
import { logger } from "../logging/logger.js";

type Config = NonNullable<Awaited<ReturnType<typeof solanaRelayConfig>>>;
export async function processSolanaRelay(input: RelayAction, lease: string, config: Config): Promise<void> {
  const chain = monadClient();
  if (await chain.getChainId() !== env.monadChainId) throw new Error("solana-relay-monad-chain-mismatch");
  const at = (await chain.getBlock({ blockTag: "finalized" })).number;
  const pending = await chain.readContract({ address: env.core as Hex, abi: termbookCoreAbi,
    functionName: input.kind === 0 ? "remoteReturnActionHash" : "remoteSeizureActionHash", args: [input.creditId], blockNumber: at });
  if (/^0x0{64}$/i.test(pending)) { await solanaRelayRepo.completed(input._id, lease); return; }
  if (pending.toLowerCase() !== input._id) throw new Error("solana-relay-authorization-changed");
  await verifyAuthorizationReceipt(input.creditId, input._id as Hex, input.kind, input.authorizationTxHash);
  const kind = input.kind === 0 ? "release" : "seize";
  const { action, programId, programDataHash } = await readSolanaAction({ creditId: input.creditId, kind });
  const connection = new Connection(config.rpcUrl, { commitment: "finalized", confirmTransactionInitialTimeout: 30_000 });
  await verifySolanaRelayProgram(connection, programId, action.sourceGenesis, programDataHash);
  for (const tx of await solanaRelayRepo.transactions(input._id)) {
    if (await deliverSolanaRelay(connection, tx) === "pending") throw new Error("solana-relay-transaction-pending");
  }
  let sourceTx = input.sourceTx;
  let mode = input.mode;
  if (!sourceTx) {
    const time = BigInt(await solanaFinalizedClock(config.rpcUrl));
    const sourceRpc = new SolanaJsonRpc(config.rpcUrl);
    const lock = await sourceRpc.getAccountInfo(solanaPubkeyBase58(action.sourceVault));
    if (!lock || lock.owner !== solanaPubkeyBase58(programId) || lock.executable) throw new Error("solana-relay-lock-invalid");
    const record = decodeSolanaLockRecord(lock.data);
    const applied = record.lastNonce === action.nonce && record.lastRevision === action.revision
      && record.lastActionHash === input._id;
    const expired = record.lastCanceledNonce === action.nonce && record.lastCanceledActionHash === input._id;
    if (!applied && !expired && action.deadline >= time && action.deadline <= time + 120n) throw new Error("solana-relay-expiry-pending");
    mode = applied ? "apply" : expired || action.deadline < time ? "expire" : "apply";
    const plan = parseSolanaActionPlan({ programId, actionHash: input._id, mode, authorizationTxHash: input.authorizationTxHash,
      action: Object.fromEntries(Object.entries(action).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])) });
    const provider = { publicKey: config.signer.publicKey, connect: async () => undefined,
      signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
        if (tx instanceof Transaction) tx.partialSign(config.signer); else tx.sign([config.signer]);
        return tx;
      } };
    const wallet = new SolanaRpcWallet(provider, connection, config.signer.publicKey.toBase58(), {
      wormholeScanUrl: config.wormholeScanUrl, authorizationAttempts: 1,
      sendSigned: (tx) => sendSolanaRelay(connection, input._id, lease, tx, config.maxTransactions),
    });
    sourceTx = await submitSolanaAction(plan, wallet, sourceRpc);
    await solanaRelayRepo.sourced(input._id, lease, sourceTx, mode);
  }
  if (!mode) throw new Error("solana-relay-mode-invalid");
  const confirmation = await solanaActionService.confirmationPlan({ creditId: input.creditId, kind, mode, sourceTx });
  if (confirmation.actionHash.toLowerCase() !== input._id) throw new Error("solana-relay-confirmation-mismatch");
  const result = await keeperTransaction({ client: chain, rpcUrl: env.rpcUrl, chainId: env.monadChainId,
    account: config.keeper, operation: `${input._id}:solana:${mode}`, to: confirmation.to as Hex, data: confirmation.data });
  if (result === "reverted") throw new Error("solana-relay-confirmation-reverted");
  if (result === "success") await solanaRelayRepo.completed(input._id, lease);
}
async function schedule(job: { kind: string; payload: Record<string, unknown> }): Promise<void> {
  const { creditId, actionHash, kind, authorizationTxHash } = job.payload;
  if (job.kind !== "collateral.solana-authorized") return;
  if (![creditId, actionHash, authorizationTxHash].every((value) => typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value))
    || kind !== 0 && kind !== 1) throw new Error("solana-relay-job-invalid");
  await verifyAuthorizationReceipt(creditId as Hex, actionHash as Hex, kind, authorizationTxHash as Hex);
  await solanaRelayRepo.open({ _id: String(actionHash).toLowerCase(), creditId: creditId as Hex, kind,
    authorizationTxHash: authorizationTxHash as Hex });
}
registerHandler(["collateral.solana-authorized"], schedule);
let running = false;
export async function runSolanaRelayWorker(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    await drainQueue(schedule, ["collateral.solana-authorized"]);
    const config = await solanaRelayConfig();
    if (!config) return 0;
    let count = 0;
    for (; count < 8; ++count) {
      const claimed = await solanaRelayRepo.claim();
      if (!claimed) break;
      let lost = false;
      const heartbeat = setInterval(() => { void solanaRelayRepo.renew(claimed.action._id, claimed.lease)
        .then((ok) => { if (!ok) lost = true; }).catch(() => { lost = true; }); }, 15_000);
      let failure: string | undefined;
      try {
        await processSolanaRelay(claimed.action, claimed.lease, config);
        if (lost) throw new Error("solana-relay-lease-lost");
      } catch (error) {
        failure = error instanceof Error ? error.message : "solana-relay-unavailable";
        logger.warn("solana-source-relay-failed", { actionHash: claimed.action._id, failure });
      } finally {
        clearInterval(heartbeat);
        await solanaRelayRepo.release(claimed.action._id, claimed.lease, failure, claimed.action.failures);
      }
    }
    return count;
  } finally { running = false; }
}
