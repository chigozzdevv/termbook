import { randomUUID } from "node:crypto";
import type { SolanaSignedTransaction } from "@termbook/sdk";
import { withTx } from "../database/transaction.js";
import { SolanaRelayModel, SolanaRelayTransactionModel } from "./solana-relay.model.js";

export type RelayAction = { _id: string; creditId: `0x${string}`; kind: 0 | 1; authorizationTxHash: `0x${string}`;
  sourceTx?: string; mode?: "apply" | "expire"; failures?: number };
export type RelayTransaction = { _id: string; actionHash: string; raw: string; blockhash: string;
  lastValidBlockHeight: number; status: string };
const duration = 120_000;
export const solanaRelayRepo = {
  async open(input: Omit<RelayAction, "sourceTx" | "mode" | "failures">): Promise<void> {
    await SolanaRelayModel.updateOne({ _id: input._id }, { $setOnInsert: input }, { upsert: true });
    const saved = await SolanaRelayModel.findById(input._id).lean();
    if (!saved || saved["creditId"] !== input.creditId || saved["kind"] !== input.kind
      || saved["authorizationTxHash"] !== input.authorizationTxHash) throw new Error("solana-relay-identity-conflict");
  },
  async claim(): Promise<{ action: RelayAction; lease: string } | null> {
    const lease = randomUUID();
    const action = await SolanaRelayModel.findOneAndUpdate({ state: { $in: ["pending", "source_finalized"] },
      nextRunAt: { $lte: new Date() }, $or: [{ leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: new Date() } }] },
      { $set: { lease, leaseExpiresAt: new Date(Date.now() + duration) } }, { sort: { nextRunAt: 1, _id: 1 }, new: true }).lean();
    return action ? { action: action as unknown as RelayAction, lease } : null;
  },
  async renew(id: string, lease: string): Promise<boolean> {
    return (await SolanaRelayModel.updateOne({ _id: id, lease, leaseExpiresAt: { $gt: new Date() } },
      { $set: { leaseExpiresAt: new Date(Date.now() + duration) } })).modifiedCount === 1;
  },
  async prepared(id: string, lease: string, tx: SolanaSignedTransaction, maxTransactions: number): Promise<void> {
    await withTx(async (session) => {
      const existing = await SolanaRelayTransactionModel.findById(tx.signature).session(session).lean();
      const raw = Buffer.from(tx.raw).toString("base64");
      if (existing) {
        if (existing["actionHash"] !== id || existing["raw"] !== raw) throw new Error("solana-relay-transaction-conflict");
        return;
      }
      const update = await SolanaRelayModel.updateOne({ _id: id, lease, leaseExpiresAt: { $gt: new Date() },
        transactionCount: { $lt: maxTransactions } }, { $inc: { transactionCount: 1 } }, { session });
      if (update.modifiedCount !== 1) throw new Error("solana-relay-lease-or-budget");
      await SolanaRelayTransactionModel.create([{ _id: tx.signature, actionHash: id, raw,
        blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight }], { session });
    });
  },
  async transactions(id: string): Promise<RelayTransaction[]> {
    return await SolanaRelayTransactionModel.find({ actionHash: id, status: "prepared" }).sort({ createdAt: 1 }).limit(128).lean() as unknown as RelayTransaction[];
  },
  async transactionResult(signature: string, status: "success" | "reverted" | "expired", slot?: number): Promise<void> {
    await SolanaRelayTransactionModel.updateOne({ _id: signature, status: "prepared" }, { $set: { status, slot } });
  },
  async sourced(id: string, lease: string, sourceTx: string, mode: "apply" | "expire"): Promise<void> {
    if ((await SolanaRelayModel.updateOne({ _id: id, lease, leaseExpiresAt: { $gt: new Date() } },
      { $set: { sourceTx, mode, state: "source_finalized" } })).modifiedCount !== 1) throw new Error("solana-relay-lease-lost");
  },
  async completed(id: string, lease: string): Promise<void> {
    if ((await SolanaRelayModel.updateOne({ _id: id, lease, leaseExpiresAt: { $gt: new Date() } },
      { $set: { state: "confirmed" } })).modifiedCount !== 1) throw new Error("solana-relay-lease-lost");
  },
  async release(id: string, lease: string, failure?: string, failures = 0): Promise<void> {
    await SolanaRelayModel.updateOne({ _id: id, lease }, { $unset: { lease: 1, leaseExpiresAt: 1 }, $set: {
      nextRunAt: new Date(Date.now() + (failure ? Math.min(300_000, 5000 * 2 ** Math.min(failures, 6)) : 5000)),
      ...(failure ? { failure, failures: failures + 1 } : {}),
    } });
  },
};
