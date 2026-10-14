import { describe, expect, it, vi } from "vitest";
import { custom, decodeFunctionData, encodeFunctionResult, multicall3Abi, parseAbi } from "viem";
import { monadClient } from "../../src/chain/monad.client.js";

vi.mock("../../src/config/env.js", () => ({ env: { rpcUrl: "http://monad", rpcRequestsPerSecond: 4, monadChainId: 10143 } }));
const batches: number[] = [];
vi.mock("../../src/chain/rpc.transport.js", () => ({ pacedHttp: () => custom({ request: async ({ method, params }) => {
  if (method !== "eth_call") throw new Error("unexpected-rpc-call");
  const [request] = params as [{ data: `0x${string}` }];
  const decoded = decodeFunctionData({ abi: multicall3Abi, data: request.data });
  const calls = decoded.args![0] as readonly { callData: `0x${string}` }[];
  batches.push(calls.length);
  return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: calls.map((call) => ({
    success: true, returnData: encodeFunctionResult({ abi: parseAbi(["function value(uint256) view returns(uint256)"]),
      functionName: "value", result: decodeFunctionData({ abi: parseAbi(["function value(uint256) view returns(uint256)"]), data: call.callData }).args![0] }),
  })) });
} }) }));

describe("Monad read batching", () => {
  it("groups contract reads instead of issuing one RPC call per argument-bearing read", async () => {
    const address = `0x${"11".repeat(20)}` as const;
    const values = await monadClient().multicall({ multicallAddress: address, allowFailure: false, blockNumber: 100n,
      contracts: Array.from({ length: 65 }, (_, i) => ({ address, abi: parseAbi(["function value(uint256) view returns(uint256)"]),
        functionName: "value", args: [BigInt(i)] })),
    });
    expect(values).toEqual(Array.from({ length: 65 }, (_, i) => BigInt(i)));
    expect(batches).toEqual([28, 4, 28, 4, 1]);
  });
});
