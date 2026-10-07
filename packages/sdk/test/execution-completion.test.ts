import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeFunctionData, keccak256, stringToHex } from "viem";
import { completeExecution, ExecutionPendingError } from "../src/app/completion.js";
import { executionCoreAbi, emptyExecutionPrice } from "../src/app/execution.js";
import type { TermbookClient } from "../src/client/client.js";
import type { ExecutionCheckpoint } from "../src/types/credit.types.js";

const word = (n: string) => `0x${n.repeat(64)}` as const;
const address = (n: string) => `0x${n.repeat(40)}` as const;
const id = word("1"), pendingId = word("2"), bundle = word("3"), hash = word("4"), core = address("5"), manager = address("6");
function fixture() {
  const checkpoint: ExecutionCheckpoint = { chainId: 143, core, creditId: id, tx: hash, capability: "place_order", stage: "submitted" };
  const receipt = { status: "success", blockNumber: 20n, blockHash: word("7"), logs: [{ address: manager,
    topics: [keccak256(stringToHex("ActionPending(bytes32,bytes32,bytes32,bytes32)")), id, pendingId],
    data: encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [keccak256(stringToHex("place_order")), word("8")]) }] };
  const state = { finalized: 20n, status: 1, filled: 0n, refunded: 0n, remaining: 100n, liability: 500n };
  const input = encodeFunctionData({ abi: executionCoreAbi, functionName: "executePlan", args: [id,
    { capability: keccak256(stringToHex("place_order")), market: word("8"), calls: [], requiredInput: 100n, exposureLimit: 500n },
    { drawAmount: 100n, maxDraw: 100n, nonce: 1n, deadline: 1n, revision: 1n, signer: address("9"), signature: "0x", price: emptyExecutionPrice }] });
  const transport = { getChainId: async () => 143,
    getBlock: vi.fn(async () => ({ number: state.finalized, hash: word("7") })),
    getTransactionReceipt: vi.fn(async () => receipt),
    getTransaction: vi.fn(async () => ({ to: core, input })),
  };
  const rpc = { client: transport, read: vi.fn(async (_address: string, _abi: unknown, name: string) => {
    if (name === "creditDetails") return { bundleId: bundle };
    if (name === "executionManager") return manager;
    if (name === "records") return [word("8"), word("8"), 500n, 0, { positionId: word("8"), committed: 100n, ...state }];
    throw new Error(name);
  }) };
  const client = { ready: async () => {}, config: { core, chainId: 143, versionId: bundle }, rpc } as unknown as TermbookClient;
  return { checkpoint, receipt, state, transport, rpc, client };
}
describe("finalized action completion", () => {
  it("binds a checkpoint's route key to its published public capability", async () => {
    const f = fixture(); f.client.config.actions = [{ capability: "place_order", executionKey: "place_order" }] as never;
    await expect(completeExecution(f.client, id, { ...f.checkpoint, executionKey: "unknown" }))
      .rejects.toMatchObject({ message: "action-checkpoint-invalid" });
    await expect(completeExecution(f.client, id, { ...f.checkpoint, capability: "cancel_order", executionKey: "place_order" }))
      .rejects.toMatchObject({ message: "action-checkpoint-invalid" });
    expect(f.transport.getTransaction).not.toHaveBeenCalled();
    f.state.status = 3; f.state.filled = 100n; f.state.remaining = 0n; f.state.liability = 0n;
    await expect(completeExecution(f.client, id, { ...f.checkpoint, executionKey: "place_order" })).resolves.toMatchObject({ status: "settled" });
  });
  it("resumes a submitted action and reports a partial fill followed by cancellation accurately", async () => {
    const f = fixture(), reconcile = vi.fn(async () => {
      f.state.status = 4; f.state.filled = 40n; f.state.refunded = 60n; f.state.remaining = 0n; f.state.liability = 0n;
      return { tx: hash };
    });
    const result = await completeExecution(f.client, id, f.checkpoint, { pollIntervalMs: 1 }, reconcile);
    expect(result).toMatchObject({ status: "partial", draw: 100n, outcomes: [{ status: "cancelled", filled: 40n, refunded: 60n, remaining: 0n }] });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(f.rpc.read.mock.calls.filter((call) => call[2] === "records").every((call) => (call as unknown[])[4] === 20n)).toBe(true);
  });
  it("waits for source transaction finality before accepting its pending records", async () => {
    const f = fixture(); f.state.finalized = 19n;
    let checkpoint;
    try { await completeExecution(f.client, id, f.checkpoint, { timeoutMs: 15, pollIntervalMs: 2 }); }
    catch (error) { if (error instanceof ExecutionPendingError) checkpoint = error.checkpoint; else throw error; }
    expect(checkpoint?.tx).toBe(hash);
    expect(f.rpc.read).not.toHaveBeenCalled();
    f.state.finalized = 20n; f.state.status = 6; f.state.refunded = 100n; f.state.remaining = 0n; f.state.liability = 0n;
    expect(await completeExecution(f.client, id, checkpoint!)).toMatchObject({ status: "expired", draw: 100n });
  });
  it("does not turn a refund into debt repayment or an unresolved order into success", async () => {
    const f = fixture(); f.state.filled = 30n; f.state.refunded = 20n; f.state.remaining = 50n;
    const reconcile = vi.fn(async () => ({ tx: hash }));
    await expect(completeExecution(f.client, id, f.checkpoint, { timeoutMs: 20, pollIntervalMs: 1, maxReconciliations: 1 }, reconcile))
      .rejects.toMatchObject({ checkpoint: { stage: "pending", tx: hash }, outcomes: [{ filled: 30n, refunded: 20n, remaining: 50n }] });
    expect(reconcile).toHaveBeenCalledOnce();
  });
  it("rejects substituted checkpoints and changed canonical receipt hashes", async () => {
    const f = fixture();
    await expect(completeExecution(f.client, id, { ...f.checkpoint, creditId: word("a") })).rejects.toThrow("action-checkpoint-invalid");
    expect(f.transport.getTransactionReceipt).not.toHaveBeenCalled();
    f.receipt.blockHash = word("a");
    await expect(completeExecution(f.client, id, f.checkpoint)).rejects.toMatchObject({ message: "action-receipt-mismatch", checkpoint: { tx: hash } });
  });
  it("retains the submitted transaction when external persistence is interrupted", async () => {
    const f = fixture();
    await expect(completeExecution(f.client, id, f.checkpoint, { onProgress: async () => { throw new Error("storage-offline"); } }))
      .rejects.toMatchObject({ message: "storage-offline", checkpoint: { tx: hash, stage: "submitted" } });
    expect(f.transport.getTransactionReceipt).not.toHaveBeenCalled();
  });
});
