import { RemoteActionModel, RemoteActionSignerModel } from "./remote-action.model.js";
import type { RemoteActionRecord } from "./remote-action.js";

const transitions: Record<string, string[]> = {
  submitted: ["prepared", "submitted"],
  mined: ["prepared", "submitted", "mined"],
  source_finalized: ["prepared", "submitted", "mined", "source_finalized"],
  reverted: ["prepared", "submitted", "mined"],
  expired: ["pending"],
  external_execution: ["pending"],
};
const confirmTransitions: Record<string, string[]> = {
  confirm_submitted: ["confirm_prepared", "confirm_submitted"],
  confirm_mined: ["confirm_prepared", "confirm_submitted", "confirm_mined"],
  confirm_reverted: ["confirm_prepared", "confirm_submitted", "confirm_mined"],
  finalized: ["source_finalized", "confirm_prepared", "confirm_submitted", "confirm_mined", "confirm_reverted"],
};

function equalIdentity(saved: Record<string, unknown>, doc: RemoteActionRecord): boolean {
  const action = saved["action"];
  if (!action || typeof action !== "object" || Array.isArray(action)) return false;
  const stored = action as Record<string, unknown>;
  return saved["creditId"] === doc.creditId && saved["kind"] === doc.kind
    && saved["authorizationTxHash"] === doc.authorizationTxHash
    && Object.keys(doc.action).every((key) =>
      String(stored[key]).toLowerCase() === String(doc.action[key as keyof typeof doc.action]).toLowerCase());
}

export const remoteActionRepo = {
  async open(doc: RemoteActionRecord) {
    try {
      await RemoteActionModel.updateOne({ actionHash: doc.actionHash }, {
        $setOnInsert: { ...doc, state: "pending" },
      }, { upsert: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 11000)) throw error;
    }
    const saved = await RemoteActionModel.findOne({ actionHash: doc.actionHash }).lean();
    if (!saved || !equalIdentity(saved, doc)) throw new Error("remote-action-conflict");
    return saved;
  },
  async finishTopUp(actionHash: string, outcome: 1 | 2) {
    return RemoteActionModel.updateOne({ actionHash, kind: 2, state: "pending" },
      { $set: { state: outcome === 1 ? "finalized" : "expired" }, $unset: { failure: 1, nextRunAt: 1 } });
  },
  async defer(actionHash: string, delay: number, failure?: string) {
    if (!Number.isSafeInteger(delay) || delay < 1 || delay > 300_000) throw new Error("remote-action-retry-delay-invalid");
    return RemoteActionModel.updateOne({ actionHash, state: { $in: ["pending", "prepared", "submitted", "mined", "external_execution", "source_finalized",
      "confirm_prepared", "confirm_submitted", "confirm_mined"] } },
      { $max: { nextRunAt: new Date(Date.now() + delay) }, ...(failure ? { $set: { failure }, $inc: { failures: 1 } } : {}) });
  },
  async find(actionHash: string) {
    return RemoteActionModel.findOne({ actionHash }).lean();
  },
  async listPending() {
    return RemoteActionModel.find({ state: { $in: [
      "pending", "prepared", "submitted", "mined", "external_execution", "source_finalized",
      "confirm_prepared", "confirm_submitted", "confirm_mined",
    ] }, $or: [{ nextRunAt: { $exists: false } }, { nextRunAt: { $lte: new Date() } }] })
      .sort({ nextRunAt: 1, createdAt: 1 }).limit(10).lean();
  },
  async listByCredit(creditId: string) {
    return RemoteActionModel.find({ creditId }).select("actionHash creditId kind authorizationTxHash state txHash confirmTxHash failure")
      .sort({ createdAt: -1 }).lean();
  },
  async prepare(actionHash: string, txHash: string, rawTx: string, sourceNonce: number) {
    return RemoteActionModel.updateOne({ actionHash, txHash: { $exists: false }, state: "pending" }, {
      $set: { txHash, rawTx, sourceNonce, state: "prepared" },
    });
  },
  async prepareConfirmation(actionHash: string, txHash: string, rawTx: string, confirmNonce: number) {
    return RemoteActionModel.updateOne({ actionHash, confirmTxHash: { $exists: false }, state: "source_finalized" }, {
      $set: { confirmTxHash: txHash, confirmRawTx: rawTx, confirmNonce, state: "confirm_prepared" },
    });
  },
  async confirmationState(actionHash: string, state: string, confirmTxHash: string, fields: Record<string, unknown> = {}) {
    const from = confirmTransitions[state];
    if (!from) throw new Error("remote-action-state-invalid");
    return RemoteActionModel.updateOne({ actionHash, confirmTxHash, state: { $in: from } }, {
      $set: { state, ...fields },
      ...(state === "finalized" ? { $unset: { rawTx: 1, confirmRawTx: 1 } } : {}),
    });
  },
  async finalizeWithoutConfirmation(actionHash: string) {
    return RemoteActionModel.updateOne({
      actionHash, state: "source_finalized", confirmTxHash: { $exists: false },
    }, { $set: { state: "finalized" }, $unset: { rawTx: 1 } });
  },
  async attachExternalSourceTx(actionHash: string, txHash: string) {
    return RemoteActionModel.updateOne({
      actionHash, state: "external_execution", txHash: { $exists: false },
    }, { $set: { txHash, state: "source_finalized" }, $unset: { failure: 1 } });
  },
  async finalizeExternallyConfirmed(actionHash: string) {
    return RemoteActionModel.updateOne({ actionHash, state: "external_execution" }, {
      $set: { state: "finalized" }, $unset: { failure: 1 },
    });
  },
  async state(actionHash: string, state: string, txHash?: string, fields: Record<string, unknown> = {}) {
    const from = transitions[state];
    if (!from) throw new Error("remote-action-state-invalid");
    return RemoteActionModel.updateOne({ actionHash, ...(txHash ? { txHash } : {}), state: { $in: from } }, {
      $set: { state, ...fields },
    });
  },
  async acquireSigner(signer: string, actionHash: string, chainId = 1): Promise<boolean> {
    const key = `${chainId}:${signer.toLowerCase()}`;
    try {
      await RemoteActionSignerModel.updateOne({ _id: key }, { $setOnInsert: { _id: key } }, { upsert: true });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 11000)) throw error;
    }
    const claimed = await RemoteActionSignerModel.findOneAndUpdate({
      _id: key, $or: [{ actionHash: { $exists: false } }, { actionHash }],
    }, { $set: { actionHash } }, { new: true }).lean();
    return Boolean(claimed);
  },
  async releaseSigner(signer: string, actionHash: string, chainId = 1): Promise<void> {
    await RemoteActionSignerModel.updateOne({ _id: `${chainId}:${signer.toLowerCase()}`, actionHash }, {
      $unset: { actionHash: "" },
    });
  },
};
