import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rpcRoute } from "../../src/chain/rpc.route.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { buildApp } from "../../src/app.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
const read = vi.fn();
beforeEach(() => { vi.clearAllMocks(); read.mockResolvedValue("0x279f"); vi.mocked(monadClient).mockReturnValue({ request: read } as never); });
async function rpc(body: unknown, full = false) {
  const app = full ? buildApp() : Fastify(); if (!full) rpcRoute(app);
  const response = await app.inject({ method: "POST", url: "/rpc", payload: body as never }); await app.close(); return response;
}
const request = (method: string, params: unknown[] = [], id = 1) => ({ jsonrpc: "2.0", method, params, id });
describe("Public read-only RPC", () => {
  it("supports SDK reads without requiring a wallet signature", async () => {
    const response = await rpc(request("eth_chainId"), true);
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ id: 1, result: "0x279f" });
  });
  it("preserves batch IDs and prevents writes and arbitrary methods", async () => {
    const response = await rpc([request("eth_chainId"), request("eth_sendRawTransaction", ["0x1"], 2)]);
    expect(response.json()).toMatchObject([{ id: 1, result: "0x279f" }, { id: 2, error: { code: -32601 } }]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("bounds calldata, gas, block ranges and batch size", async () => {
    const account = `0x${"1".repeat(40)}`;
    for (const params of [[{ to: account, gas: "0xffffffff" }, "latest"], [{ to: account, gas: "invalid" }, "latest"]]) {
      expect((await rpc(request("eth_call", params))).json().error.code).toBe(-32602);
    }
    expect((await rpc(request("eth_getLogs", [{ address: account, fromBlock: "0x0", toBlock: "0xffff" }]))).json().error.code).toBe(-32602);
    expect((await rpc(Array.from({ length: 9 }, () => request("eth_chainId")))).statusCode).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("does not disclose provider errors or keys", async () => {
    read.mockRejectedValue(new Error("https://provider/private-key"));
    const response = await rpc(request("eth_chainId"));
    expect(response.body).not.toContain("private-key"); expect(response.json().error.code).toBe(-32000);
  });
  it("supports native value simulations and preserves encoded contract reverts", async () => {
    read.mockRejectedValue({ code: 3, data: "0x12345678", message: "provider/private-key" });
    const response = await rpc(request("eth_call", [{ to: `0x${"1".repeat(40)}`, value: "0x1", data: "0x" }, "latest"]));
    expect(response.json().error).toEqual({ code: 3, message: "Execution reverted", data: "0x12345678" });
  });
});
