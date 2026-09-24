import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAbiParameters } from "viem";
import { env } from "../../src/config/env.js";
import { fetchFinalizedBeaconExecution } from "../../src/chain/ethereum-beacon-proof.js";
import { fetchProof, lockCommitmentSlot } from "../../src/chain/source.client.js";
import { lockCommitment } from "../../src/collateral/collateral.worker.js";

vi.mock("../../src/chain/ethereum-execution-header.js", () => ({
  buildEthereumSourceHeader: vi.fn(async () => "0x1234"),
}));
vi.mock("../../src/chain/ethereum-beacon-proof.js", () => ({ fetchFinalizedBeaconExecution: vi.fn() }));

const lockId = `0x${"11".repeat(32)}` as const;
const commitment = `0x${"22".repeat(32)}` as const;
const codeHash = `0x${"33".repeat(32)}` as const;
const blockHash = `0x${"44".repeat(32)}` as const;
const stateRoot = `0x${"55".repeat(32)}` as const;
const vault = `0x${"aa".repeat(20)}` as const;
const input = {
  rpcUrl: "https://ethereum.example/rpc",
  lockId, vault, commitment, expectedCodeHash: codeHash,
};

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function rpcResponse(value: unknown): Response {
  return response({ jsonrpc: "2.0", id: 1, result: value });
}

function mockSource(overrides: {
  finalized?: string;
  selectedHash?: string;
  selectedRoot?: string;
  storageKey?: string;
  storageValue?: string;
  proofCodeHash?: string;
  chainId?: string;
  proofError?: boolean;
} = {}) {
  const requests: { method?: string; params?: unknown[]; url: string }[] = [];
  const mock = vi.fn(async (raw: string | URL | Request, options?: RequestInit) => {
    const url = String(raw);
    const request = options?.body ? JSON.parse(String(options.body)) as { method: string; params: unknown[] } : undefined;
    requests.push({ method: request?.method, params: request?.params, url });
    if (!request) throw new Error("unexpected HTTP request");
    if (request.method === "eth_chainId") return rpcResponse(overrides.chainId ?? "0x1");
    if (request.method === "eth_getBlockByHash") return rpcResponse({
      number: "0xa", hash: overrides.selectedHash ?? blockHash,
      stateRoot,
    });
    if (request.method === "eth_getBlockByNumber" && request.params[0] === "finalized") {
      return rpcResponse({ number: overrides.finalized ?? "0xb" });
    }
    if (request.method === "eth_getBlockByNumber") {
      return rpcResponse({ number: "0xa", hash: overrides.selectedHash ?? blockHash, stateRoot: overrides.selectedRoot ?? stateRoot });
    }
    if (request.method === "eth_getProof") {
      if (overrides.proofError) return response({ jsonrpc: "2.0", id: 1, error: { code: -32602 } });
      return rpcResponse({
        address: vault,
        codeHash: overrides.proofCodeHash ?? codeHash,
        accountProof: ["0xc1"],
        storageProof: [{ key: overrides.storageKey ?? lockCommitmentSlot(lockId), value: overrides.storageValue ?? commitment, proof: ["0xc2"] }],
      });
    }
    throw new Error(`unexpected RPC method ${request.method}`);
  });
  vi.stubGlobal("fetch", mock);
  return requests;
}

beforeEach(() => {
  env.sourceBeaconApiUrl = "https://beacon.example";
  vi.mocked(fetchFinalizedBeaconExecution).mockResolvedValue({
    finalizedBeaconRoot: `0x${"99".repeat(32)}`, executionBlockHash: blockHash, slot: 13_000_000n,
  });
});

afterEach(() => {
  env.sourceBeaconApiUrl = "";
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("Ethereum source proof assembly", () => {
  it("requests account and storage nodes at the canonical finalized block hash", async () => {
    const requests = mockSource();
    const result = await fetchProof(input);
    expect(requests.find((item) => item.method === "eth_getBlockByHash")?.params?.[0]).toBe(blockHash);
    const proofRequest = requests.find((item) => item.method === "eth_getProof");
    expect(proofRequest?.params).toEqual([vault, [lockCommitmentSlot(lockId)], { blockHash, requireCanonical: true }]);
    const [id, accountNodes, storageNodes] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes[]" }, { type: "bytes[]" }], result.proof,
    );
    expect([id, accountNodes, storageNodes]).toEqual([lockId, ["0xc1"], ["0xc2"]]);
    expect(result.stateRoot).toBe(stateRoot);
  });

  it("uses a verified Beacon finality update for a current lock state proof", async () => {
    const requests = mockSource();
    await fetchProof(input);
    expect(fetchFinalizedBeaconExecution).toHaveBeenCalledWith(env.sourceBeaconApiUrl);
    expect(requests.some((item) => item.method === "eth_getBlockByHash"
      && item.params?.[0] === blockHash)).toBe(true);
    expect(requests.every((item) => !item.url.includes("/proof/"))).toBe(true);
    mockSource({ selectedHash: `0x${"66".repeat(32)}` });
    await expect(fetchProof(input)).rejects.toThrow("proof-block-mismatch");
  });

  it.each([
    [{ chainId: "0x2" }, "source-chain-mismatch"],
    [{ finalized: "0x9" }, "proof-not-finalized"],
    [{ selectedHash: `0x${"66".repeat(32)}` }, "proof-block-mismatch"],
    [{ selectedRoot: `0x${"66".repeat(32)}` }, "proof-block-mismatch"],
    [{ storageKey: `0x${"77".repeat(32)}` }, "proof-commitment-mismatch"],
    [{ storageValue: "0x0" }, "proof-commitment-mismatch"],
    [{ proofCodeHash: `0x${"88".repeat(32)}` }, "proof-code-mismatch"],
    [{ proofError: true }, "proof-unavailable"],
  ] as const)("rejects mismatched source proof data %#", async (overrides, reason) => {
    mockSource(overrides);
    await expect(fetchProof(input)).rejects.toThrow(reason);
  });

  it("binds the recovery destination and Monad core in the lock digest", () => {
    const context = {
      creditId: lockId, lockId, borrower: vault, owner: vault, vault,
      asset: vault, amount: 100n, sourceChain: 1n, returnRecipient: vault,
      recoveryVault: vault, monadChain: 143n, core: vault,
    };
    const digest = lockCommitment(context);
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(lockCommitment({ ...context, recoveryVault: `0x${"bb".repeat(20)}` })).not.toBe(digest);
    expect(lockCommitment({ ...context, core: `0x${"bb".repeat(20)}` })).not.toBe(digest);
  });
});
