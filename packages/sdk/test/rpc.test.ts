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
