import { termbookCoreAbi } from "@termbook/bindings";
import { decodeEventLog, decodeFunctionData, parseAbi, type Hex, type TransactionReceipt } from "viem";
import type { TermbookClient } from "../client/client.js";
import type { CollateralArgs, CollateralChangeCheckpoint, CollateralChangeOptions } from "../types/collateral.types.js";
import { parseEvmActionPlan } from "./evm-action.js";
import { parseSolanaActionPlan } from "./solana-action.js";
import { solanaAlias } from "./solana.js";

const abi = parseAbi([
  "function addCollateral(bytes32 creditId,uint256 amount,uint256 deadline) payable",
  "function withdrawCollateral(bytes32 creditId,uint256 amount) payable",
  "function collateralActionOutcome(bytes32) view returns (uint8)",
  "function collateralSourceChainOf(bytes32) view returns (uint256)",
  "function remoteCollateral(bytes32) view returns (bool)",
  "function solanaCollateral(bytes32) view returns (bool)",
  "function collateralOwnerOf(bytes32) view returns (address)",
  "function pendingCollateralTopUp(bytes32) view returns (uint256 amount,bytes32 actionHash,uint256 revision,uint256 deadline)",
  "function confirmCollateralTopUp(bytes32,bytes,bytes)",
  "function cancelExpiredCollateralTopUp(bytes32,bytes,bytes)",
]);
const word = /^0x[a-fA-F0-9]{64}$/;
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export class CollateralChangePendingError extends Error {
  constructor(readonly checkpoint: CollateralChangeCheckpoint, cause?: unknown) {
    super("collateral-change-pending", { cause });
  }
}
export class CollateralChangeFailedError extends Error {
  constructor(readonly checkpoint: CollateralChangeCheckpoint) { super("collateral-change-failed"); }
}
export class CollateralChangeExpiredError extends Error {
  constructor(readonly checkpoint: CollateralChangeCheckpoint) { super("collateral-change-expired"); }
}
const field = (v: Record<string, unknown>, key: string, index: number) => Array.isArray(v) ? v[index] : v[key];
function key(client: TermbookClient, creditId: Hex, operation: string) {
  return `termbook:collateral:${client.config.chainId}:${client.config.core.toLowerCase()}:${creditId.toLowerCase()}:${operation}`;
}
export function savedCollateralChange(client: TermbookClient, creditId: Hex, operation: "add" | "withdraw") {
  try {
    const raw = globalThis.localStorage?.getItem(key(client, creditId, operation));
    return raw ? JSON.parse(raw) as CollateralChangeCheckpoint : undefined;
  } catch { return undefined; }
}
async function pause(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms); signal?.addEventListener("abort", done, { once: true });
  });
}

export async function changeCollateral(client: TermbookClient, creditId: Hex, operation: "add" | "withdraw",
  args: CollateralArgs, options: CollateralChangeOptions = {}) {
  await client.ready();
  const timeout = options.timeoutMs ?? 30 * 60_000, interval = options.pollIntervalMs ?? 3_000;
  if (args.amount <= 0n || !Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(interval) || interval <= 0) throw new Error("param-invalid");
  const rpc = client.rpc, chain = rpc.client, core = client.config.core;
  const saved = options.checkpoint ?? savedCollateralChange(client, creditId, operation);
  let checkpoint = saved && (options.checkpoint || saved.stage !== "complete") ? { ...saved } : undefined;
  if (checkpoint && (checkpoint.chainId !== client.config.chainId || !equal(checkpoint.core, core)
    || !equal(checkpoint.creditId, creditId) || checkpoint.operation !== operation || checkpoint.amount !== String(args.amount)
    || !word.test(checkpoint.authorizationTx) || checkpoint.actionHash && !word.test(checkpoint.actionHash)
    || checkpoint.confirmationTx && !word.test(checkpoint.confirmationTx)
    || !["submitted", "authorized", "source_submitted", "complete"].includes(checkpoint.stage))) throw new Error("collateral-checkpoint-invalid");
  if (await chain.getChainId() !== client.config.chainId) throw new Error("chain-mismatch");
  const details = await rpc.creditDetails(creditId), lockId = field(details, "lockId", 22) as Hex;
  if (!word.test(lockId) || BigInt(lockId) === 0n) throw new Error("collateral-unavailable");
  if (!equal(String(field(details, "borrower", 2)), client.signer.address())) throw new Error("borrower-wallet-required");
  if (args.asset && !equal(args.asset, String(field(details, "collateralAsset", 7)))
    || args.recipient && !equal(args.recipient, String(field(details, "returnRecipient", 8)))) throw new Error("collateral-binding-mismatch");
  const sourceChain = await rpc.read<bigint>(core, abi, "collateralSourceChainOf", [creditId]);
  const remote = await rpc.read<boolean>(core, abi, "remoteCollateral", [creditId]);
  const solana = remote && await rpc.read<boolean>(core, abi, "solanaCollateral", [creditId]);
  if (args.sourceChain !== undefined && BigInt(args.sourceChain) !== sourceChain) throw new Error("collateral-binding-mismatch");
  let sourceWallet = options.sourceWallet;
  let market: Awaited<ReturnType<typeof client.catalog.collateralMarkets>>[number] | undefined;
  const progress = async () => {
    if (!checkpoint) return;
    try { globalThis.localStorage?.setItem(key(client, creditId, operation), JSON.stringify(checkpoint)); } catch { /* External persistence is supported. */ }
    await options.onProgress?.({ ...checkpoint });
  };
  const until = Date.now() + timeout;
  const interrupted = () => {
    if (Date.now() >= until || options.signal?.aborted) {
      if (checkpoint) throw new CollateralChangePendingError(checkpoint);
      throw new Error("collateral-change-aborted");
    }
  };
  const finalizedReceipt = async (tx: Hex): Promise<TransactionReceipt> => {
    for (;;) {
      interrupted();
      const receipt = await chain.getTransactionReceipt({ hash: tx }).catch(() => undefined);
      const finalized = await chain.getBlock({ blockTag: "finalized" });
      if (receipt && receipt.blockNumber <= finalized.number) {
        const block = await chain.getBlock({ blockNumber: receipt.blockNumber });
        if (!equal(block.hash, receipt.blockHash) || !equal(block.transactions[receipt.transactionIndex]!, tx)) throw new Error("collateral-transaction-noncanonical");
        if (receipt.status !== "success") throw new Error("transaction-reverted");
        return receipt;
      }
      await pause(Math.max(1, Math.min(interval, until - Date.now())), options.signal);
    }
  };
  try {
    if (!checkpoint) {
      interrupted();
      if (await rpc.facility(creditId) !== 4) throw new Error("collateral-state-invalid");
      let value = remote ? solana ? await rpc.solanaWormholeFee() : await rpc.ethereumWormholeFee() : 0n;
      if (!remote && operation === "add") {
        const vault = field(details, "collateralVault", 6) as Hex, asset = field(details, "collateralAsset", 7) as Hex;
        const native = await chain.readContract({ address: vault, abi: parseAbi(["function isNativeCollateralVault() pure returns (bool)"]), functionName: "isNativeCollateralVault", blockTag: "finalized" });
        if (native) value = args.amount;
        else await rpc.wait(await rpc.approve(asset, vault, args.amount));
      }
      const tx = operation === "add"
        ? await rpc.coreWrite("addCollateral", [creditId, args.amount, BigInt(args.deadline ?? Math.floor(Date.now() / 1000) + 3600)], value)
        : await rpc.coreWrite("withdrawCollateral", [creditId, args.amount], value);
      checkpoint = { chainId: client.config.chainId, core, creditId, operation, amount: String(args.amount),
        authorizationTx: tx, stage: "submitted" };
      await progress();
    } else await progress();
    let receipt: TransactionReceipt;
    try { receipt = await finalizedReceipt(checkpoint.authorizationTx); }
    catch (cause) {
      if (!(cause instanceof Error) || cause.message !== "transaction-reverted") throw cause;
      checkpoint.stage = "complete"; await progress();
      throw new CollateralChangeFailedError(checkpoint);
    }
    const waitConfirmation = async () => {
      if (!checkpoint?.confirmationTx) return;
      try { await finalizedReceipt(checkpoint.confirmationTx); }
      catch (cause) {
        if (cause instanceof Error && cause.message === "transaction-reverted") {
          delete checkpoint.confirmationTx;
          await progress();
        }
        throw cause;
      }
    };
    const tx = await chain.getTransaction({ hash: checkpoint.authorizationTx });
    if (!tx.to || !equal(tx.to, core)) throw new Error("collateral-transaction-mismatch");
    const decoded = decodeFunctionData({ abi, data: tx.input });
    if (decoded.functionName !== (operation === "add" ? "addCollateral" : "withdrawCollateral")
      || !equal(decoded.args[0] as Hex, creditId) || decoded.args[1] !== args.amount) throw new Error("collateral-transaction-mismatch");
    if (!remote) { checkpoint.stage = "complete"; await progress(); return { lockId, tx: checkpoint.authorizationTx, checkpoint, status: "completed" as const }; }
    const events = receipt.logs.flatMap((log) => {
      if (!equal(log.address, core)) return [];
      try {
        const event = decodeEventLog({ abi: termbookCoreAbi, data: log.data, topics: log.topics });
        return event.eventName === "RemoteActionAuthorized" && equal(event.args.creditId, creditId)
          && event.args.kind === (operation === "add" ? 2 : 0) ? [event.args.actionHash] : [];
      } catch { return []; }
    });
    if (events.length !== 1 || checkpoint.actionHash && !equal(checkpoint.actionHash, events[0]!)) throw new Error("collateral-authorization-mismatch");
    checkpoint.actionHash = events[0]!;
    checkpoint.stage = checkpoint.sourceTx ? "source_submitted" : "authorized"; await progress();
    for (;;) {
      interrupted();
      const at = (await chain.getBlock({ blockTag: "finalized" })).number;
      const outcome = Number(await rpc.read(core, abi, "collateralActionOutcome", [checkpoint.actionHash], at));
      if (outcome === 1 || outcome === 2) {
        checkpoint.stage = "complete"; await progress();
        if (outcome === 2) throw new CollateralChangeExpiredError(checkpoint);
        return { lockId, tx: checkpoint.authorizationTx, checkpoint, status: "completed" as const };
      }
      if (outcome !== 0) throw new Error("collateral-outcome-invalid");
      try {
      if (operation === "withdraw") {
        await client.authenticatedPost("/collateral/actions", { creditId, kind: "release", authorizationTxHash: checkpoint.authorizationTx });
      } else {
        if (checkpoint.confirmationTx) {
          await waitConfirmation();
        } else {
          const pending = await rpc.read<readonly [bigint, Hex, bigint, bigint]>(core, abi, "pendingCollateralTopUp", [creditId], at);
          if (pending[0] !== args.amount || !equal(pending[1], checkpoint.actionHash)) throw new Error("collateral-authorization-mismatch");
          const expired = pending[3] < (await chain.getBlock({ blockTag: "finalized" })).timestamp;
          if (!checkpoint.sourceTx && (!expired || solana)) {
            if (!sourceWallet) {
              market = (await client.catalog.collateralMarkets()).find((m) => m.chainId === Number(sourceChain)
                && equal(m.kind === "solana" ? solanaAlias(m.genesis as Hex, m.program as Hex) : m.vault, String(field(details, "collateralVault", 6)))
                && equal(m.kind === "solana" ? solanaAlias(m.genesis as Hex, m.asset as Hex) : m.asset, String(field(details, "collateralAsset", 7))));
              if (!market) throw new Error("collateral-market-unavailable");
              sourceWallet = await client.sourceWallet(market);
            }
            if (!sourceWallet.submitAction) throw new Error("source-action-wallet-unavailable");
            const plan = await client.authenticatedPost<unknown>(solana ? "/collateral/solana/actions/plan" : "/collateral/topups/plan",
              { creditId, authorizationTxHash: checkpoint.authorizationTx, ...(solana ? { kind: "topup", mode: expired ? "expire" : "apply" } : {}) });
            if (solana) {
              const p = parseSolanaActionPlan(plan), a = p.action;
              if (!equal(p.actionHash, checkpoint.actionHash) || !equal(a.creditId, creditId) || !equal(a.lockId, lockId)
                || a.kind !== 2 || a.amountLamports !== args.amount || a.monadChain !== BigInt(client.config.chainId)
                || !equal(a.monadCore, core) || !equal(sourceWallet.account.accountBytes, a.recipient)
                || !equal(solanaAlias(a.sourceGenesis, p.programId), String(field(details, "collateralVault", 6)))
                || !equal(solanaAlias(a.sourceGenesis, a.asset), String(field(details, "collateralAsset", 7)))) throw new Error("collateral-source-plan-mismatch");
            } else {
              const p = parseEvmActionPlan(plan), a = p.action;
              if (!equal(p.actionHash, checkpoint.actionHash) || !equal(a.creditId, creditId) || !equal(a.lockId, lockId)
                || a.amount !== args.amount || a.monadChain !== BigInt(client.config.chainId) || !equal(a.monadCore, core)
                || a.sourceChain !== sourceChain || !equal(sourceWallet.account.accountBytes, a.recipient)
                || !equal(a.sourceVault, String(field(details, "collateralVault", 6))) || !equal(a.asset, String(field(details, "collateralAsset", 7)))) throw new Error("collateral-source-plan-mismatch");
            }
            if (!(plan as { consumed?: boolean }).consumed) {
              checkpoint.sourceTx = (await sourceWallet.submitAction(plan)).txId;
              checkpoint.stage = "source_submitted"; await progress();
            }
          }
          const confirmationPath = solana ? "/collateral/solana/actions/confirmation-plan" : "/collateral/topups/confirmation-plan";
          const confirmationBody = { creditId, ...(solana ? { kind: "topup" } : {}),
            ...(checkpoint.sourceTx ? { sourceTx: checkpoint.sourceTx } : {}) };
          let confirmation: { to: Hex; data: Hex; actionHash: Hex; mode: string };
          try {
            confirmation = await client.authenticatedPost(confirmationPath, { ...confirmationBody, mode: "apply" });
          } catch (error) {
            if (!expired || !(error instanceof Error) || !["source-action-not-applied", "solana-action-proof-rejected", "source-action-proof-rejected"].includes(error.message)) throw error;
            confirmation = await client.authenticatedPost(confirmationPath, { ...confirmationBody, mode: "expire" });
          }
          if (!["apply", "expire"].includes(confirmation.mode) || !equal(confirmation.to, core) || !equal(confirmation.actionHash, checkpoint.actionHash)) throw new Error("collateral-confirmation-mismatch");
          const call = decodeFunctionData({ abi, data: confirmation.data });
          if (call.functionName !== (confirmation.mode === "apply" ? "confirmCollateralTopUp" : "cancelExpiredCollateralTopUp")
            || !equal(call.args[0] as Hex, creditId)) throw new Error("collateral-confirmation-mismatch");
          checkpoint.confirmationTx = await rpc.coreWrite(call.functionName, call.args);
          await progress(); await waitConfirmation();
        }
      }
      } catch (error) {
        if (!(error instanceof Error) || !["wormhole-vaa-unavailable", "solana-proof-unavailable", "ethereum-wormhole-not-finalized",
          "ethereum-wormhole-signer-busy", "source-action-not-finalized", "monad-wormhole-not-finalized", "monad-wormhole-signer-busy"].includes(error.message)) throw error;
      }
      await pause(Math.max(1, Math.min(interval, until - Date.now())), options.signal);
    }
  } catch (cause) {
    if (cause instanceof CollateralChangeFailedError || cause instanceof CollateralChangeExpiredError || cause instanceof CollateralChangePendingError) throw cause;
    if (checkpoint) throw new CollateralChangePendingError(checkpoint, cause);
    throw cause;
  }
}
