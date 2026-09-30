import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData } from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
import { Credit } from "../src/credit/credit.js";

const id = `0x${"1".repeat(64)}` as const;
const core = `0x${"2".repeat(40)}` as const;
const asset = `0x${"3".repeat(40)}` as const;
const tx = `0x${"4".repeat(64)}` as const;
function fixture() {
  const topics = encodeEventTopics({ abi: termbookCoreAbi, eventName: "Repaid", args: { creditId: id } });
  let input = "0x" as `0x${string}`;
  const blockHash = tx;
  const payer = core;
  const rpc = {
    creditDetails: async () => ({ debt: 200n, vault: core }),
    read: vi.fn(async (_address: unknown, _abi: unknown, name: string) => name === "repaymentQuote" ? [210n, 220n] : asset),
    coreWrite: vi.fn(async (_name: string, _args: readonly unknown[]) => {
      input = encodeFunctionData({ abi: termbookCoreAbi, functionName: _name, args: _args } as never); return tx;
    }),
    approve: vi.fn(async (_asset: string, _spender: string, _amount: bigint) => tx), debt: async () => 0n,
    creditFreeCash: vi.fn(async () => 219n),
    wait: vi.fn(async () => ({ logs: [{ address: core, topics,
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [215n, 0n]) }] })),
  };
  const finalized = {
    getChainId: async () => 143,
    getBlock: async () => ({ number: 1n, hash: blockHash, transactions: [tx] }),
    getTransaction: async () => ({ to: core, from: payer, input, value: 0n }),
    readContract: async () => 0n,
    getTransactionReceipt: async () => ({ ...(await rpc.wait()), status: "success", blockNumber: 1n, blockHash, transactionIndex: 0 }),
  };
  const credit = new Credit({ ready: async () => {}, config: { core, chainId: 143 }, signer: { address: () => payer },
    rpc: { ...rpc, client: finalized } } as never, id);
  return { credit, rpc };
}
describe("capped repayment", () => {
  it("uses live accrued debt, authorizes the delay cap, and reports the exact settled payment", async () => {
    const { credit, rpc } = fixture();
    const deadline = Math.floor(Date.now() / 1000) + 900;
    const result = await credit.repay({ amount: "max", from: "wallet", deadline });
    expect(rpc.approve.mock.calls).toEqual([[asset, core, 220n], [asset, core, 0n]]);
    expect(rpc.coreWrite).toHaveBeenCalledWith("repayUpTo", [id, 220n, BigInt(deadline), false, true]);
    expect(result).toMatchObject({ applied: 215n, remaining: 0n, status: "applied" });
  });
  it("preserves an explicit reviewed cap and clips account repayment to verified free cash", async () => {
    const { credit, rpc } = fixture();
    await credit.repay({ amount: "max", from: "credit_account", maxPayment: 220n });
    expect(rpc.coreWrite.mock.calls[0]?.[1]).toMatchObject([id, 219n, expect.any(BigInt), true, true]);
    expect(rpc.approve).not.toHaveBeenCalled();
    await expect(credit.repay({ amount: "max", from: "wallet", maxPayment: 209n })).rejects.toThrow("repayment-cap-invalid");
  });
  it("does not lose a confirmed repayment when clearing the unused approval fails", async () => {
    const { credit, rpc } = fixture();
    rpc.approve.mockResolvedValueOnce(tx).mockRejectedValueOnce(new Error("wallet-dismissed"));
    expect(await credit.repay({ amount: "max", from: "wallet" })).toMatchObject({
      applied: 215n, tx, approvalCleanupRequired: true,
    });
    expect(rpc.coreWrite).toHaveBeenCalledOnce();
  });
});
