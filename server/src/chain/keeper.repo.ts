import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { KeeperTransactionModel, KeeperWalletModel } from "./keeper.model.js";

export type PendingTransaction = { id: string; hash: Hex; raw: Hex; nonce: number; to: Address; data: Hex;
  testnetConfirmations?: number;
  testnetFinality?: "safe";
  previous?: { hash: Hex; raw: Hex }[] };
const duration = 120_000;
export const keeperRepo = {
  async claim(key: string): Promise<{ lease: string; pending?: PendingTransaction } | null> {
    const lease = randomUUID();
    try {
      const doc = await KeeperWalletModel.findOneAndUpdate({ _id: key, $or: [
        { leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: new Date() } },
      ] }, { $set: { lease, leaseExpiresAt: new Date(Date.now() + duration) } }, { upsert: true, returnDocument: "after" }).lean();
      return { lease, ...(doc?.["pending"] ? { pending: doc["pending"] as PendingTransaction } : {}) };
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return null;
      throw error;
    }
  },
  async renew(key: string, lease: string): Promise<boolean> {
    const result = await KeeperWalletModel.updateOne({ _id: key, lease, leaseExpiresAt: { $gt: new Date() } },
      { $set: { leaseExpiresAt: new Date(Date.now() + duration) } });
    return result.modifiedCount === 1;
  },
  async prepared(key: string, lease: string, pending: PendingTransaction): Promise<void> {
    const result = await KeeperWalletModel.updateOne({ _id: key, lease, leaseExpiresAt: { $gt: new Date() },
      pending: { $exists: false } }, { $set: { pending } });
    if (result.modifiedCount !== 1) throw new Error("keeper-lease-lost");
  },
  async result(id: string): Promise<"success" | "reverted" | undefined> {
    const doc = await KeeperTransactionModel.findById(id).lean();
    return doc?.["status"] as "success" | "reverted" | undefined;
  },
  async replaced(key: string, lease: string, prior: Hex, pending: PendingTransaction): Promise<void> {
    const result = await KeeperWalletModel.updateOne({ _id: key, lease, "pending.hash": prior,
      leaseExpiresAt: { $gt: new Date() } }, { $set: { pending } });
    if (result.modifiedCount !== 1) throw new Error("keeper-lease-lost");
  },
  async completed(key: string, lease: string, pending: PendingTransaction,
    status: "success" | "reverted", block: bigint, blockHash: Hex, minedHash: Hex = pending.hash): Promise<void> {
    await KeeperTransactionModel.updateOne({ _id: `tx:${minedHash}` }, { $setOnInsert: {
      hash: minedHash, status, nonce: pending.nonce, block: block.toString(), blockHash,
    } }, { upsert: true });
    try {
      await KeeperTransactionModel.updateOne({ _id: pending.id, $or: [
        { nonce: { $exists: false } }, { nonce: { $lt: pending.nonce } }, { hash: minedHash },
      ] }, { $set: { hash: minedHash, status, nonce: pending.nonce, block: block.toString(), blockHash } }, { upsert: true });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const result = await KeeperWalletModel.updateOne({ _id: key, lease, "pending.hash": pending.hash,
      leaseExpiresAt: { $gt: new Date() } }, { $unset: { pending: 1 } });
    if (result.modifiedCount !== 1) throw new Error("keeper-lease-lost");
  },
  async release(key: string, lease: string): Promise<void> {
    await KeeperWalletModel.updateOne({ _id: key, lease }, { $unset: { lease: 1, leaseExpiresAt: 1 } });
  },
};
