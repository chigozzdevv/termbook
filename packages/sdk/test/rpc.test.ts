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
  const bundleId = `0x${"2".repeat(64)}` as const;
  const source = `0x${"3".repeat(40)}` as const;

  it("reads free cash from the bound health source", async () => {
    const rpc = rpcWithReceipt("success");
    const read = vi.spyOn(rpc, "read").mockResolvedValueOnce(source).mockResolvedValueOnce({ debt: 100n, cash: 25n });
    expect(await rpc.creditFreeCash(creditId, bundleId, 5n, 100n)).toBe(25n);
    expect(read).toHaveBeenLastCalledWith(source, expect.any(Array), "snapshot", [creditId, bundleId, 5n, 100n]);
  });

  it("rejects mismatched debt instead of using a token balance", async () => {
    const rpc = rpcWithReceipt("success");
    vi.spyOn(rpc, "read").mockResolvedValueOnce(source).mockResolvedValueOnce({ debt: 99n, cash: 25n });
    await expect(rpc.creditFreeCash(creditId, bundleId, 5n, 100n)).rejects.toThrow("free-cash-unavailable");
  });
});
