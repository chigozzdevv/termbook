import { houseVaultAbi, termbookCoreAbi } from "@termbook/bindings";
import { decodeEventLog, decodeFunctionData, type Hex, type TransactionReceipt } from "viem";
import type { TermbookClient } from "../client/client.js";

export type LocalPaymentCheckpoint = {
  kind: "repay" | "deposit"; chainId: number; target: Hex; payer: Hex; token: Hex;
  creditId?: Hex; amount: string; deadline: number; minShares?: string; fromAccount?: boolean; requireFull?: boolean;
  tx?: Hex; stage: "reviewed" | "submitted" | "complete";
};
export type LocalPaymentOptions = {
  localCheckpoint?: LocalPaymentCheckpoint; timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal;
  onLocalProgress?: (checkpoint: LocalPaymentCheckpoint) => void | Promise<void>;
};
export class LocalPaymentFailedError extends Error {
  constructor(readonly checkpoint: LocalPaymentCheckpoint) { super("local-payment-failed"); }
}
export class LocalPaymentPendingError extends Error {
  constructor(readonly checkpoint: LocalPaymentCheckpoint, cause?: unknown) { super("local-payment-pending", { cause }); }
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function key(client: TermbookClient, request: Pick<LocalPaymentCheckpoint, "chainId" | "payer" | "target" | "kind" | "creditId">) {
  return `termbook:local-payment:${request.chainId}:${request.payer.toLowerCase()}:${request.target.toLowerCase()}:${request.kind}:${request.creditId ?? ""}`;
}
export function savedLocalPayment(client: TermbookClient, request: Pick<LocalPaymentCheckpoint, "chainId" | "payer" | "target" | "kind" | "creditId">): LocalPaymentCheckpoint | undefined {
  try { const raw = globalThis.localStorage?.getItem(key(client, request)); return raw ? JSON.parse(raw) : undefined; }
  catch { return undefined; }
}
export async function localPayment(client: TermbookClient, request: LocalPaymentCheckpoint, options: LocalPaymentOptions = {}) {
  await client.ready();
  const stored = options.localCheckpoint ?? savedLocalPayment(client, request);
  const resume = stored && (options.localCheckpoint || stored.stage !== "complete");
  const checkpoint = resume ? { ...stored } : { ...request };
  if (checkpoint.chainId !== client.config.chainId || !same(checkpoint.payer, client.signer.address())
    || checkpoint.kind !== request.kind || !same(checkpoint.target, request.target) || checkpoint.creditId !== request.creditId
    || !["reviewed", "submitted", "complete"].includes(checkpoint.stage)) throw new Error("payment-checkpoint-invalid");
  if (resume && !options.localCheckpoint && (checkpoint.amount !== request.amount || checkpoint.deadline !== request.deadline
    || checkpoint.minShares !== request.minShares || checkpoint.fromAccount !== request.fromAccount || checkpoint.requireFull !== request.requireFull)) throw new Error("payment-already-pending");
  const amount = BigInt(checkpoint.amount), deadline = BigInt(checkpoint.deadline);
  if (amount <= 0n || !Number.isSafeInteger(checkpoint.deadline) || checkpoint.minShares && BigInt(checkpoint.minShares) < 0n) throw new Error("param-invalid");
  const timeout = options.timeoutMs ?? 30 * 60_000, interval = options.pollIntervalMs ?? 2_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(interval) || interval <= 0) throw new Error("param-invalid");
  const until = Date.now() + timeout;
  const progress = async () => {
    try { globalThis.localStorage?.setItem(key(client, checkpoint), JSON.stringify(checkpoint)); } catch { /* Callbacks support external persistence. */ }
    await options.onLocalProgress?.({ ...checkpoint });
  };
  const interrupted = () => { if (Date.now() >= until || options.signal?.aborted) throw new LocalPaymentPendingError(checkpoint); };
  await progress();
  try {
    const chain = client.rpc.client;
    if (await chain.getChainId() !== client.config.chainId) throw new Error("chain-mismatch");
    const abi = checkpoint.kind === "repay" ? termbookCoreAbi : houseVaultAbi;
    const functionName = checkpoint.kind === "repay" ? "repayUpTo" : "depositBound";
    const args = checkpoint.kind === "repay" ? [checkpoint.creditId, amount, deadline, !!checkpoint.fromAccount, !!checkpoint.requireFull]
      : [checkpoint.payer, amount, BigInt(checkpoint.minShares ?? "0"), deadline];
    if (!checkpoint.tx) {
      interrupted();
      if (Date.now() >= checkpoint.deadline * 1000) throw new Error("payment-review-expired");
      if (!checkpoint.fromAccount) await client.rpc.wait(await client.rpc.approve(checkpoint.token, checkpoint.target, amount));
      interrupted();
      checkpoint.tx = checkpoint.kind === "repay" ? await client.rpc.coreWrite(functionName, args)
        : await client.rpc.write(checkpoint.target, abi, functionName, args);
      checkpoint.stage = "submitted"; await progress();
    }
    let receipt: TransactionReceipt | undefined;
    for (;;) {
      interrupted();
      receipt = await chain.getTransactionReceipt({ hash: checkpoint.tx }).catch(() => undefined);
      const finalized = await chain.getBlock({ blockTag: "finalized" });
      if (receipt && receipt.blockNumber <= finalized.number) break;
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, Math.min(interval, Math.max(1, until - Date.now())));
        options.signal?.addEventListener("abort", done, { once: true });
      });
    }
    const [block, tx] = await Promise.all([chain.getBlock({ blockNumber: receipt.blockNumber }), chain.getTransaction({ hash: checkpoint.tx })]);
    if (!same(receipt.blockHash, block.hash) || !same(block.transactions[receipt.transactionIndex]!, checkpoint.tx)
      || !tx.to || !same(tx.to, checkpoint.target) || !same(tx.from, checkpoint.payer) || tx.value !== 0n) throw new Error("payment-transaction-invalid");
    const decoded = decodeFunctionData({ abi, data: tx.input });
    if (decoded.functionName !== functionName || decoded.args?.length !== args.length
      || args.some((arg, i) => String(arg).toLowerCase() !== String(decoded.args![i]).toLowerCase())) throw new Error("payment-transaction-invalid");
    if (receipt.status !== "success") {
      checkpoint.stage = "complete"; await progress(); throw new LocalPaymentFailedError(checkpoint);
    }
    let applied = 0n, shares = 0n;
    for (const log of receipt.logs) {
      if (!same(log.address, checkpoint.target)) continue;
      try {
        const event = decodeEventLog({ abi, data: log.data, topics: log.topics });
        const values = event.args as Record<string, unknown>;
        if (event.eventName === "Repaid" && same(String(values["creditId"]), checkpoint.creditId!)) applied += BigInt(String(values["amount"]));
        if (event.eventName === "Deposited" && same(String(values["payer"]), checkpoint.payer)
          && same(String(values["recipient"]), checkpoint.payer) && BigInt(String(values["amount"])) === amount) shares += BigInt(String(values["shares"]));
      } catch { /* Ignore unrelated logs. */ }
    }
    if (checkpoint.kind === "deposit" && (shares === 0n || shares < BigInt(checkpoint.minShares ?? "0"))
      || checkpoint.kind === "repay" && applied > amount) throw new Error("payment-receipt-invalid");
    const remaining = checkpoint.kind === "repay" ? await chain.readContract({ address: client.config.core, abi: termbookCoreAbi,
      functionName: "creditDebt", args: [checkpoint.creditId!], blockNumber: receipt.blockNumber }) : 0n;
    checkpoint.stage = "complete"; await progress();
    return { checkpoint, tx: checkpoint.tx, applied, remaining, shares };
  } catch (error) {
    if (error instanceof LocalPaymentPendingError || error instanceof LocalPaymentFailedError) throw error;
    throw new LocalPaymentPendingError(checkpoint, error);
  }
}
