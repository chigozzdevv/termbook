import { describe, expect, it, vi } from "vitest";
import { RpcClient } from "../src/transport/rpc.js";

const hash = "0x0123" as const;

function rpcWithReceipt(status: "success" | "reverted"): RpcClient {
  const rpc = Object.create(RpcClient.prototype) as RpcClient;
  rpc.config = { chainId: 1, confirmations: 2 } as RpcClient["config"];
  rpc.client = {
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status, transactionHash: hash }),
  } as unknown as RpcClient["client"];
  return rpc;
}

describe("transaction confirmation", () => {
  it("waits for the configured confirmations", async () => {
    const rpc = rpcWithReceipt("success");
    await expect(rpc.wait(hash)).resolves.toMatchObject({ status: "success" });
    expect(rpc.client.waitForTransactionReceipt).toHaveBeenCalledWith({ hash, confirmations: 2 });
  });

  it("does not report a reverted transaction as successful", async () => {
    const rpc = rpcWithReceipt("reverted");
    await expect(rpc.wait(hash)).rejects.toThrow("transaction-reverted");
  });
});

describe("verified free cash", () => {
  const creditId = `0x${"1".repeat(64)}` as const;

  it("reads free cash validated against actual custody by Core", async () => {
    const rpc = rpcWithReceipt("success");
    const read = vi.spyOn(rpc, "read").mockResolvedValueOnce(25n);
    expect(await rpc.creditFreeCash(creditId)).toBe(25n);
    expect(read).toHaveBeenLastCalledWith(rpc.config.core, expect.any(Array), "creditFreeCash", [creditId]);
  });

  it("rejects unavailable cash instead of using a token balance", async () => {
    const rpc = rpcWithReceipt("success");
    vi.spyOn(rpc, "read").mockResolvedValueOnce(undefined);
    await expect(rpc.creditFreeCash(creditId)).rejects.toThrow("free-cash-unavailable");
  });
});

describe("current account health", () => {
  const creditId = `0x${"1".repeat(64)}` as const;
  const core = `0x${"2".repeat(40)}` as const;
  function healthRpc() {
    const rpc = rpcWithReceipt("success");
    rpc.config.core = core;
    const read = vi.fn(async ({ functionName }: { functionName: string }) => ({
      creditDebt: 210n, riskEngine: core, previewHealth: { debt: 210n, healthBps: 11900n },
      liquidationBps: 11000n, freezeBps: 11500n, watchBps: 12000n,
    })[functionName]);
    rpc.client = { getChainId: async () => 1, getBlock: async () => ({ number: 100n }),
      readContract: read } as never;
    return { rpc, read };
  }
  it("uses current accrued debt and authoritative backing from one finalized block", async () => {
    const { rpc, read } = healthRpc();
    expect(await rpc.currentHealth(creditId)).toEqual({ value: 11900n, debt: 210n, state: "watch" });
    expect(read.mock.calls.every(([request]) => "blockNumber" in request && request.blockNumber === 100n)).toBe(true);
    expect(read.mock.calls.map(([request]) => request.functionName)).not.toContain("snapshot");
  });
  it("does not fall back to cached health when the oracle or reader is unavailable", async () => {
    const { rpc, read } = healthRpc();
    read.mockRejectedValue(new Error("reader-unavailable"));
    await expect(rpc.currentHealth(creditId)).rejects.toThrow("reader-unavailable");
  });
});
