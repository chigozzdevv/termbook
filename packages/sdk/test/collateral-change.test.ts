import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEventTopics, encodeFunctionData, encodeAbiParameters, parseAbi } from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
import { CreditCollateral } from "../src/collateral/collateral.js";
import { CollateralChangeFailedError, CollateralChangeExpiredError, CollateralChangePendingError } from "../src/collateral/change.js";
import { evmActionAbi, evmActionHash } from "../src/collateral/evm-action.js";
import type { TermbookClient } from "../src/client/client.js";
import type { CollateralChangeCheckpoint } from "../src/types/collateral.types.js";
const hex = (s: string, n = 64) => `0x${s.repeat(n)}` as `0x${string}`;
const creditId = hex("1"), lockId = hex("2"), core = hex("3", 40), borrower = hex("4", 40);
const vault = hex("5", 40), asset = hex("6", 40), controller = hex("7", 40);
const authorizationTx = hex("8"), confirmationTx = hex("9"), sourceTx = hex("a");
const coreAbi = parseAbi(["function addCollateral(bytes32,uint256,uint256) payable", "function withdrawCollateral(bytes32,uint256) payable",
  "function confirmCollateralTopUp(bytes32,bytes,bytes)", "function cancelExpiredCollateralTopUp(bytes32,bytes,bytes)"]);
beforeEach(() => vi.unstubAllGlobals());
function fixture(operation: "add" | "withdraw", remote = true, native = false) {
  let outcome = 0;
  const a = { monadChain: 143n, monadCore: core, sourceChain: 1n, sourceVault: vault, creditId, lockId,
    asset, kind: 2, recipient: borrower, amount: 20n, nonce: 1n, deadline: 2000n };
  const actionHash = evmActionHash(a);
  const checkpoint: CollateralChangeCheckpoint = { chainId: 143, core, creditId, operation, amount: "20", authorizationTx, stage: "submitted" };
  const sourceWallet = { account: { namespace: "eip155", reference: "1", accountBytes: borrower },
    submitAction: vi.fn(async () => ({ txId: sourceTx })) };
  const plan = { actionHash, transaction: { to: controller, data: encodeFunctionData({ abi: evmActionAbi,
    functionName: "execute", args: [a, "0xcc", "0xdd"] }) } };
  const confirmation = { actionHash, to: core, mode: "apply", data: encodeFunctionData({ abi: coreAbi,
    functionName: "confirmCollateralTopUp", args: [creditId, "0xcc", "0xdd"] }) };
  const post = vi.fn(async (path: string) => {
    if (path === "/collateral/actions") { outcome = 1; return {}; }
    return path === "/collateral/topups/plan" ? plan : confirmation;
  });
  const input = operation === "add"
    ? encodeFunctionData({ abi: coreAbi, functionName: "addCollateral", args: [creditId, 20n, 2000n] })
    : encodeFunctionData({ abi: coreAbi, functionName: "withdrawCollateral", args: [creditId, 20n] });
  const receipt = { status: "success", blockNumber: 5n, blockHash: hex("b"), transactionIndex: 0,
    logs: remote ? [{ address: core, data: encodeAbiParameters([{ type: "uint8" }], [operation === "add" ? 2 : 0]),
      topics: encodeEventTopics({ abi: termbookCoreAbi, eventName: "RemoteActionAuthorized", args: { creditId, actionHash } }) }] : [] };
  const read = vi.fn(async (_address: string, _abi: unknown, fn: string) => {
    switch (fn) {
      case "collateralSourceChainOf": return remote ? 1n : 143n;
      case "remoteCollateral": return remote;
      case "solanaCollateral": return false;
      case "collateralActionOutcome": return outcome;
      case "pendingCollateralTopUp": return [20n, actionHash, 2n, 2000n];
      default: throw new Error(`unexpected-read:${fn}`);
    }
  });
  const write = vi.fn(async (fn: string) => {
    if (fn === "confirmCollateralTopUp") { outcome = 1; return confirmationTx; }
    return authorizationTx;
  });
  const rpc = { coreWrite: write, read, facility: async () => 4, wait: async () => receipt,
    creditDetails: async () => ({ borrower, lockId, collateralVault: vault, collateralAsset: asset, returnRecipient: borrower, collateralAmount: 100n }),
    approve: vi.fn(async () => hex("c")), ethereumWormholeFee: async () => 7n,
    client: { getChainId: async () => 143, getBlock: async () => ({ number: 10n, hash: hex("b"), timestamp: 1000n, transactions: [authorizationTx] }),
      getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => ({ ...receipt, transactionIndex: hash === confirmationTx ? 1 : 0 })),
      getTransaction: async () => ({ to: core, input }), readContract: async () => native } };
  const getBlock = vi.fn(async () => ({ number: 10n, hash: hex("b"), timestamp: 1000n, transactions: [authorizationTx, confirmationTx] }));
  rpc.client.getBlock = getBlock;
  const client = { ready: async () => {}, config: { chainId: 143, core }, rpc, authenticatedPost: post,
    signer: { address: () => borrower } } as unknown as TermbookClient;
  return { credit: new CreditCollateral(client, creditId), rpc, post, sourceWallet, plan, checkpoint, actionHash,
    outcome: (n: number) => { outcome = n; } };
}
describe("collateral changes", () => {
  it("tops up local ERC-20 custody without relocking or rebinding", async () => {
    const f = fixture("add", false);
    const result = await f.credit.add({ amount: 20n, deadline: 2000 });
    expect(result.lockId).toBe(lockId);
    expect(f.rpc.approve).toHaveBeenCalledWith(asset, vault, 20n);
    expect(f.rpc.coreWrite).toHaveBeenCalledOnce();
    expect(f.rpc.coreWrite).toHaveBeenCalledWith("addCollateral", [creditId, 20n, 2000n], 0n);
    expect(result.checkpoint?.stage).toBe("complete");
  });
  it("pays exact native MON for local top-ups", async () => {
    const f = fixture("add", false, true);
    await f.credit.add({ amount: 20n, deadline: 2000 });
    expect(f.rpc.approve).not.toHaveBeenCalled();
    expect(f.rpc.coreWrite).toHaveBeenCalledWith("addCollateral", [creditId, 20n, 2000n], 20n);
  });
  it("returns a remote top-up only after Core proof confirmation", async () => {
    const f = fixture("add");
    const result = await f.credit.add({ amount: 20n, deadline: 2000 }, { sourceWallet: f.sourceWallet as never, pollIntervalMs: 1 });
    expect(f.sourceWallet.submitAction).toHaveBeenCalledOnce();
    expect(f.rpc.coreWrite).toHaveBeenCalledWith("confirmCollateralTopUp", [creditId, "0xcc", "0xdd"]);
    expect(result.checkpoint?.sourceTx).toBe(sourceTx);
    expect(result.checkpoint?.stage).toBe("complete");
  });
  it("awaits the reserved remote withdrawal outcome", async () => {
    const f = fixture("withdraw");
    const result = await f.credit.withdraw({ amount: 20n }, { pollIntervalMs: 1 });
    expect(f.post).toHaveBeenCalledWith("/collateral/actions", { creditId, kind: "release", authorizationTxHash: authorizationTx });
    expect(f.rpc.coreWrite).toHaveBeenCalledWith("withdrawCollateral", [creditId, 20n], 7n);
    expect(result.pending).toBe(false);
  });
  it("resumes persisted authorization without approving, funding, or authorizing again", async () => {
    const f = fixture("add");
    const persist = vi.fn(async () => { throw new Error("storage-offline"); });
    const error = await f.credit.add({ amount: 20n, deadline: 2000 }, { onProgress: persist }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CollateralChangePendingError);
    const cp = (error as CollateralChangePendingError).checkpoint;
    f.outcome(1);
    const result = await f.credit.resumeAddition({ checkpoint: cp });
    expect(f.rpc.coreWrite).toHaveBeenCalledOnce();
    expect(result.checkpoint.stage).toBe("complete");
  });
  it("rejects source calldata for a different authorization without sending funds", async () => {
    const f = fixture("add"); f.plan.actionHash = hex("d");
    await expect(f.credit.add({ amount: 20n, deadline: 2000 }, { sourceWallet: f.sourceWallet as never })).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "source-action-plan-invalid" }) });
    expect(f.sourceWallet.submitAction).not.toHaveBeenCalled();
  });
  it("reports a proved expired withdrawal distinctly from completion", async () => {
    const f = fixture("withdraw"); f.outcome(2);
    await expect(f.credit.resumeWithdrawal({ checkpoint: f.checkpoint })).rejects.toBeInstanceOf(CollateralChangeExpiredError);
    expect(f.rpc.coreWrite).not.toHaveBeenCalled();
  });
  it("returns a finalized failed authorization as a terminal failure without funding", async () => {
    const f = fixture("add");
    f.rpc.client.getTransactionReceipt.mockImplementation(async () => ({ status: "reverted" } as never));
    const receipt = { status: "reverted", blockNumber: 5n, blockHash: hex("b"), transactionIndex: 0, logs: [] };
    f.rpc.client.getTransactionReceipt.mockResolvedValue(receipt as never);
    const error = await f.credit.resumeAddition({ checkpoint: f.checkpoint, sourceWallet: f.sourceWallet as never }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CollateralChangeFailedError);
    expect((error as CollateralChangeFailedError).checkpoint.stage).toBe("complete");
    expect(f.sourceWallet.submitAction).not.toHaveBeenCalled();
    expect(f.rpc.coreWrite).not.toHaveBeenCalled();
  });
  it("rejects checkpoint amount changes", async () => {
    const f = fixture("withdraw");
    await expect(f.credit.withdraw({ amount: 21n }, { checkpoint: f.checkpoint })).rejects.toThrow("collateral-checkpoint-invalid");
    expect(f.rpc.coreWrite).not.toHaveBeenCalled();
  });
  it("reconciles a source transaction already consumed after interrupted submission", async () => {
    const f = fixture("add"); Object.assign(f.plan, { consumed: true });
    const result = await f.credit.resumeAddition({ checkpoint: f.checkpoint, sourceWallet: f.sourceWallet as never, pollIntervalMs: 1 });
    expect(f.sourceWallet.submitAction).not.toHaveBeenCalled();
    expect(result.checkpoint.stage).toBe("complete");
    expect(f.post).toHaveBeenCalledWith("/collateral/topups/confirmation-plan", { creditId, mode: "apply" });
  });
});
