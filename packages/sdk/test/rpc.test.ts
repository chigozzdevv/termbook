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
