import { afterEach, describe, expect, it, vi } from "vitest";
import { ContractFunctionRevertedError, createPublicClient, encodeErrorResult, parseAbi } from "viem";
import { RpcClient } from "../src/transport/rpc.js";

vi.mock("viem", async (original) => {
  const actual = await original<typeof import("viem")>();
  return { ...actual, createPublicClient: vi.fn() };
});

const previewAbi = parseAbi([
  "error ActionPreview(uint256 healthBps,uint256 initialBps,uint256 debt,uint256 recoveryValue)",
]);
const address = `0x${"1".repeat(40)}` as `0x${string}`;
const creditId = `0x${"2".repeat(64)}` as `0x${string}`;

afterEach(() => vi.clearAllMocks());

describe("action preview", () => {
  it("reads the contract simulated post action health", async () => {
    const data = encodeErrorResult({ abi: previewAbi, errorName: "ActionPreview",
      args: [12_000n, 15_000n, 200n, 240n] });
    const reverted = new ContractFunctionRevertedError({ abi: previewAbi, data, functionName: "previewAction" });
    const simulateContract = vi.fn(async () => { throw reverted; });
    vi.mocked(createPublicClient).mockReturnValue({ simulateContract } as never);
    const rpc = new RpcClient({ core: address, rpcUrl: "http://localhost:8545", chainId: 143,
      wallet: { address, signTypedData: async () => creditId } } as never);
    expect(await rpc.previewAction(creditId, address, "0x12345678", 200n, 1n)).toEqual({
      healthBps: 12_000n, initialBps: 15_000n, debt: 200n, recoveryValue: 240n,
    });
    expect(simulateContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "previewAction", args: [creditId, address, "0x12345678", 200n, 1n], account: address,
    }));
  });

  it("fails closed when the Core does not provide a preview", async () => {
    vi.mocked(createPublicClient).mockReturnValue({ simulateContract: async () => undefined } as never);
    const rpc = new RpcClient({ core: address, rpcUrl: "http://localhost:8545", chainId: 143,
      wallet: { address, signTypedData: async () => creditId } } as never);
    await expect(rpc.previewAction(creditId, address, "0x12345678", 200n, 1n))
      .rejects.toThrow("action-preview-unavailable");
  });
});
