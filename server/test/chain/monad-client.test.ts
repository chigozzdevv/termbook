import { afterEach, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, parseAbi } from "viem";
import { monadClient } from "../../src/chain/monad.client.js";

vi.mock("../../src/config/env.js", () => ({ env: { rpcUrl: "https://rpc.test/batches", rpcRequestsPerSecond: 1000 } }));
afterEach(() => vi.unstubAllGlobals());
it("bounds actual Multicall3 batches while preserving every contract result", async () => {
  const sizes: number[] = [];
  const abi = parseAbi(["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])"]);
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body);
    const data = decodeFunctionData({ abi, data: body.params[0].data });
    sizes.push(data.args[0].length);
    const result = encodeAbiParameters([{ type: "tuple[]", components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }] }],
      [data.args[0].map(() => ({ success: true, returnData: encodeAbiParameters([{ type: "uint8" }], [6]) }))]);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "content-type": "application/json" } });
  }));
  const client = monadClient();
  const contracts = Array.from({ length: 11 }, () => ({ address: `0x${"1".repeat(40)}` as `0x${string}`,
    abi: parseAbi(["function decimals() view returns(uint8)"]), functionName: "decimals" }));
  const result = await client.multicall({ contracts, allowFailure: false, multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11" });
  expect(result).toEqual(Array(11).fill(6));
  expect(sizes).toEqual([8, 3]);
});
