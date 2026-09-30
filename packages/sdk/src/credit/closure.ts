import { termbookCoreAbi, houseVaultAbi } from "@termbook/bindings";
import type { TermbookClient } from "../client/client.js";
import type { TxHash } from "../types/client.types.js";
import { CreditApp } from "../app/app.js";

export type ClosureStage = "freezing" | "unwinding" | "settlement_pending" | "repaying"
  | "funding_required" | "withdrawing_surplus" | "return_pending" | "closed";
export type ClosureCheckpoint = {
  chainId: number; core: TxHash; creditId: TxHash; stage: ClosureStage;
  mode?: "unwind" | "retain";
  authorizationTx?: TxHash; sourceTx?: string;
  actionHash?: TxHash; remoteScheduled?: boolean;
};
export type CloseOptions = {
  mode?: "unwind" | "retain";
  checkpoint?: ClosureCheckpoint; timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal;
  onProgress?: (checkpoint: ClosureCheckpoint) => void | Promise<void>;
};
export class ClosurePendingError extends Error {
  constructor(readonly checkpoint: ClosureCheckpoint, message = "close-pending") { super(message); }
}
export class ClosureFundingRequiredError extends ClosurePendingError {
  constructor(checkpoint: ClosureCheckpoint, readonly shortfall: bigint) { super(checkpoint, "close-funding-required"); }
}

const field = (details: Record<string, unknown>, key: string, index: number): unknown =>
  Array.isArray(details) ? details[index] : details[key];
const amount = (details: Record<string, unknown>, key: string, index: number): bigint => BigInt(String(field(details, key, index)));
const word = /^0x[0-9a-fA-F]{64}$/;

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("close-aborted")); return; }
    const abort = () => { clearTimeout(timer); reject(new Error("close-aborted")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function closeCredit(client: TermbookClient, creditId: TxHash, options: CloseOptions = {}):
  Promise<{ closed: true; tx?: TxHash }> {
  await client.ready();
  const timeout = options.timeoutMs ?? 30 * 60_000;
  const interval = options.pollIntervalMs ?? 3_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(interval) || interval <= 0) {
    throw new Error("param-invalid");
  }
  const key = `termbook:closure:${client.config.chainId}:${client.config.core.toLowerCase()}:${creditId.toLowerCase()}`;
  let saved = options.checkpoint;
  if (!saved) {
    try { const value = storage()?.getItem(key); if (value) saved = JSON.parse(value) as ClosureCheckpoint; } catch { /* Use onchain state. */ }
  }
  let mode = options.mode ?? saved?.mode ?? "unwind";
  if (mode !== "unwind" && mode !== "retain") throw new Error("param-invalid");
  let checkpoint: ClosureCheckpoint = { chainId: client.config.chainId, core: client.config.core,
    creditId, stage: "freezing", mode };
  if (saved) {
    if (saved.chainId !== checkpoint.chainId || saved.core?.toLowerCase() !== checkpoint.core.toLowerCase()
      || saved.creditId?.toLowerCase() !== creditId.toLowerCase()
      || (saved.mode && saved.mode !== mode)
      || (saved.authorizationTx && !word.test(saved.authorizationTx))) throw new Error("close-checkpoint-invalid");
    checkpoint = { ...saved, mode };
  }
  const progress = async (stage: ClosureStage) => {
    checkpoint.stage = stage;
    try { storage()?.setItem(key, JSON.stringify(checkpoint)); } catch { /* External persistence is also supported. */ }
    await options.onProgress?.({ ...checkpoint });
  };
  const write = async (name: string, args: readonly unknown[] = [creditId], value?: bigint): Promise<TxHash> => {
    const tx = await client.rpc.coreWrite(name, args, value);
    await client.rpc.wait(tx);
    return tx;
  };
  const until = Date.now() + timeout;
  let lastTx: TxHash | undefined;
  while (true) {
    if (options.signal?.aborted) throw new ClosurePendingError({ ...checkpoint }, "close-aborted");
    if (Date.now() >= until) throw new ClosurePendingError({ ...checkpoint });
    const details = await client.rpc.creditDetails(creditId);
    const facility = Number(field(details, "facility", 0));
    if (facility === 6) { await progress("closed"); return { closed: true, tx: lastTx }; }
    if (facility === 4) {
      await progress("freezing");
      lastTx = await write(mode === "retain" ? "startRetaining" : "startClosing");
      continue;
    }
    if (facility !== 5) throw new Error("recovery-blocked");
    const retaining = await client.rpc.read<boolean>(client.config.core, termbookCoreAbi, "closingRetention", [creditId]);
    if (!options.mode && !saved?.mode) { mode = retaining ? "retain" : "unwind"; checkpoint.mode = mode; }
    if (retaining !== (mode === "retain")) throw new ClosurePendingError({ ...checkpoint }, "close-mode-mismatch");
    const reconciled = await new CreditApp(client, creditId).syncIfChanged(details);
    if (reconciled) { lastTx = reconciled.tx; continue; }
    const debt = await client.rpc.debt(creditId);
    if (debt > 0n && await client.rpc.creditFreeCash(creditId) > 0n) {
      await progress("repaying");
      lastTx = await write("repayAvailableCash");
      continue;
    }
    const [stepId, , done, retryAt] = await client.rpc.read<readonly [TxHash, TxHash, boolean, bigint]>(
      client.config.core, termbookCoreAbi, "closeStep", [creditId]);
    if (!done) {
      if (retaining && debt > 0n && retryAt > 0n) {
        await progress("funding_required");
        throw new ClosureFundingRequiredError({ ...checkpoint }, debt);
      }
      if (retryAt > 0n) {
        await progress("settlement_pending");
        await pause(Math.min(interval, until - Date.now()), options.signal);
      } else {
        await progress(retaining ? "settlement_pending" : "unwinding");
        lastTx = await write("advanceClose", [creditId, stepId]);
      }
      continue;
    }
    if (debt > 0n) {
      await progress("funding_required");
      throw new ClosureFundingRequiredError({ ...checkpoint }, debt);
    }
    const cash = await client.rpc.creditFreeCash(creditId);
    if (cash > 0n) {
      await progress("withdrawing_surplus");
      const vault = field(details, "vault", 4) as TxHash;
      const asset = await client.rpc.read<TxHash>(vault, houseVaultAbi, "asset");
      lastTx = await write("withdraw", [creditId, asset, client.signer.address(), cash]);
      continue;
    }
    if (field(details, "collateralReturned", 24)) {
      lastTx = await write("finishClose");
      continue;
    }
    await progress("return_pending");
    const remote = await client.rpc.read<boolean>(client.config.core, termbookCoreAbi, "remoteCollateral", [creditId]);
    const pending = remote ? await client.rpc.read<bigint>(client.config.core, termbookCoreAbi,
      "pendingRemoteReturn", [creditId]) : 0n;
    const solana = remote && await client.rpc.read<boolean>(client.config.core, termbookCoreAbi, "solanaCollateral", [creditId]);
    if (pending === 0n) {
      const remaining = amount(details, "collateralAmount", 9);
      if (remaining <= 0n) throw new Error("collateral-return-required");
      const tx = await client.rpc.coreWrite("authorizeReturn", [creditId, field(details, "lockId", 22), remaining],
        solana ? await client.rpc.solanaWormholeFee() : remote ? await client.rpc.ethereumWormholeFee() : undefined);
      checkpoint.authorizationTx = tx;
      delete checkpoint.sourceTx;
      delete checkpoint.actionHash;
      delete checkpoint.remoteScheduled;
      await progress("return_pending");
      await client.rpc.wait(tx);
      lastTx = tx;
      if (!remote) continue;
    }
    const actionHash = await client.rpc.read<TxHash>(client.config.core, termbookCoreAbi, "remoteReturnActionHash", [creditId]);
    if (checkpoint.actionHash && checkpoint.actionHash.toLowerCase() !== actionHash.toLowerCase()) {
      delete checkpoint.authorizationTx;
      delete checkpoint.sourceTx;
      delete checkpoint.remoteScheduled;
    }
    checkpoint.actionHash = actionHash;
    if (!checkpoint.authorizationTx) {
      const currentHash = await client.rpc.read<TxHash>(client.config.core, termbookCoreAbi, "remoteReturnActionHash", [creditId]);
      const event = (await client.rpc.creditActivity(creditId)).find((row) => row.event === "RemoteActionAuthorized"
        && String(row.args["actionHash"]).toLowerCase() === currentHash.toLowerCase());
      if (!event?.transactionHash) throw new ClosurePendingError({ ...checkpoint }, "close-authorization-unavailable");
      checkpoint.authorizationTx = event.transactionHash;
      await progress("return_pending");
    }
    try {
      if (!checkpoint.remoteScheduled) {
        await client.authenticatedPost("/collateral/actions", {
          creditId, kind: "release", authorizationTxHash: checkpoint.authorizationTx,
        });
        checkpoint.remoteScheduled = true;
        await progress("return_pending");
      }
    } catch (error) {
      if (!(error instanceof Error) || !["solana-proof-unavailable", "solana-wormhole-authorization-unavailable",
        "remote-action-unavailable", "remote-action-authorization-unfinalized", "solana-action-unavailable"].includes(error.message)) throw error;
    }
    await pause(Math.max(1, Math.min(interval, until - Date.now())), options.signal);
  }
}
