import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, keccak256 } from "viem";
import { consumedActionSlot, fetchUnconsumedActionProof } from "../../src/chain/source.client.js";

const actionHash = `0x${"11".repeat(32)}` as const;
const controller = `0x${"22".repeat(20)}` as const;
const codeHash = `0x${"33".repeat(32)}` as const;
const blockHash = `0x${"44".repeat(32)}` as const;
const stateRoot = `0x${"55".repeat(32)}` as const;
const emptyRoot = keccak256("0x80");

function reply(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function source(overrides: { timestamp?: string; value?: string; storageHash?: string; codeHash?: string } = {}) {
  const requests: { method?: string; params?: unknown[]; url: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (raw: string | URL | Request, options?: RequestInit) => {
    const request = options?.body ? JSON.parse(String(options.body)) as { method: string; params: unknown[] } : undefined;
    requests.push({ method: request?.method, params: request?.params, url: String(raw) });
    if (!request) return reply({ header: "0x1234", blockNumber: "0xa", blockHash, stateRoot });
    let result: unknown;
    if (request.method === "eth_chainId") result = "0x1";
    else if (request.method === "eth_getBlockByNumber" && request.params[0] === "finalized") result = { number: "0xb" };
    else if (request.method === "eth_getBlockByNumber") result = {
      number: "0xa", hash: blockHash, stateRoot, timestamp: overrides.timestamp ?? "0x65",
    };
    else if (request.method === "eth_getProof") result = {
      address: controller, codeHash: overrides.codeHash ?? codeHash,
      accountProof: ["0xc1"], storageHash: overrides.storageHash ?? emptyRoot,
      storageProof: [{ key: consumedActionSlot(actionHash), value: overrides.value ?? "0x0", proof: [] }],
    };
    else throw new Error(`unexpected ${request.method}`);
    return reply({ jsonrpc: "2.0", id: 1, result });
  }));
  return requests;
}

const input = {
  rpcUrl: "https://ethereum.example", finalityUrl: "https://proof.example/api",
  actionHash, controller, expectedCodeHash: codeHash, deadline: 100n,
};

afterEach(() => vi.unstubAllGlobals());

describe("expired Ethereum action absence proof", () => {
  it("binds finalized timestamp, controller code, and consumed mapping slot", async () => {
    const requests = source();
    const result = await fetchUnconsumedActionProof(input);
    expect(requests[1]?.url).toBe(`https://proof.example/api/absence/${actionHash}`);
    expect(requests.find((item) => item.method === "eth_getProof")?.params).toEqual([
      controller, [consumedActionSlot(actionHash)], { blockHash, requireCanonical: true },
    ]);
    const [id, accountNodes, storageNodes] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes[]" }, { type: "bytes[]" }], result.proof,
    );
    expect([id, accountNodes, storageNodes]).toEqual([actionHash, ["0xc1"], []]);
  });

  it.each([
    [{ timestamp: "0x64" }, "proof-before-deadline"],
    [{ value: "0x1" }, "proof-consumed"],
    [{ codeHash: `0x${"66".repeat(32)}` }, "proof-code-mismatch"],
    [{ storageHash: `0x${"77".repeat(32)}` }, "proof-invalid"],
  ] as const)("rejects an unsafe cancellation proof %#", async (overrides, reason) => {
    source(overrides);
    await expect(fetchUnconsumedActionProof(input)).rejects.toThrow(reason);
  });
});
