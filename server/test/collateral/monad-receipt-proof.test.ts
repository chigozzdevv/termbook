import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, encodeAbiParameters, keccak256, padHex, stringToHex, toRlp, type Hex, type TransactionReceipt } from "viem";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

import { monadClient } from "../../src/chain/monad.client.js";
import { authorizationLogIndex, buildReceiptProof, encodeReceipt, fetchMonadAuthorizationProof } from "../../src/chain/monad-receipt-proof.js";
import { env } from "../../src/config/env.js";

const core = `0x${"11".repeat(20)}` as const;
const creditId = `0x${"22".repeat(32)}` as const;
const actionHash = `0x${"33".repeat(32)}` as const;
const txHash = `0x${"44".repeat(32)}` as const;
const blockHash = `0x${"55".repeat(32)}` as const;
const topic = keccak256(stringToHex("RemoteActionAuthorized(bytes32,bytes32,uint8)"));
const bloom = `0x${"00".repeat(256)}` as const;
const originalChainId = env.monadChainId;

function receipt(index: number, action = false, type: TransactionReceipt["type"] = "legacy"): TransactionReceipt {
  return {
    blockHash, blockNumber: 100n, transactionHash: index === 0 ? txHash : `0x${index.toString(16).padStart(64, "0")}`,
    transactionIndex: index, type, status: "success", cumulativeGasUsed: BigInt(index + 1),
    logsBloom: bloom, logs: action ? [{
      address: core, data: encodeAbiParameters([{ type: "uint8" }], [1]),
      topics: [topic, creditId, actionHash], blockHash, blockNumber: 100n,
      transactionHash: index === 0 ? txHash : `0x${index.toString(16).padStart(64, "0")}`,
      transactionIndex: index, logIndex: 0, removed: false,
    }] : [],
    from: core, to: core, contractAddress: null, effectiveGasPrice: 1n, gasUsed: 1n,
  };
}

afterEach(() => { vi.unstubAllGlobals(); env.monadChainId = originalChainId; });

describe("Monad receipt trie proof", () => {
  it("matches the Solidity verifier's Viem receipt-root vector", () => {
    const sourceVault = `0x${"0".repeat(36)}beef` as const;
    const recipient = `0x${"0".repeat(36)}abcd` as const;
    const applied = {
      ...receipt(0),
      logs: [{
        ...receipt(0).logs[0], address: sourceVault,
        topics: [
          keccak256(stringToHex("RemoteActionApplied(bytes32,bytes32,address,uint256,uint8)")),
          keccak256(stringToHex("action")), keccak256(stringToHex("lock")), padHex(recipient, { size: 32 }),
        ],
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }], [400n, 1]),
      }],
    } as TransactionReceipt;
    expect(buildReceiptProof([applied], 0, 0).receiptsRoot).toBe(
      "0xb1ad6fbf80b264f407f6079a0fb9a22d8c21e6573d8848be1729375237d8c754",
    );
  });

  it("matches the canonical single-leaf receipt root and proof encoding", () => {
    const item = receipt(0, true, "eip1559");
    const serialized = encodeReceipt(item);
    expect(serialized.slice(0, 4)).toBe("0x02");
    const expectedLeaf = toRlp(["0x2080", serialized]);
    const result = buildReceiptProof([item], 0, 0);
    expect(result.receiptsRoot).toBe(keccak256(expectedLeaf));
    const [index, log, nodes] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "bytes[]" }], result.proof,
    );
    expect([index, log, nodes]).toEqual([0n, 0n, [expectedLeaf]]);
    expect(authorizationLogIndex(item, core, creditId, actionHash, 1)).toBe(0);
  });

  it("builds the expected hashed branch for two receipts", () => {
    const left = receipt(0, true);
    const right = receipt(1);
    const leaf0 = toRlp(["0x30", encodeReceipt(left)]);
    const leaf1 = toRlp(["0x31", encodeReceipt(right)]);
    const branch = Array.from({ length: 17 }, (_, index) =>
      index === 0 ? keccak256(leaf1) : index === 8 ? keccak256(leaf0) : "0x");
    const expectedRoot = keccak256(toRlp(branch));
    const result = buildReceiptProof([left, right], 0, 0);
    expect(result.receiptsRoot).toBe(expectedRoot);
    expect(result.nodes).toEqual([toRlp(branch), leaf0]);
  });

  it("uses the RLP receipt key at index 128", () => {
    const items = Array.from({ length: 129 }, (_, index) => receipt(index, index === 128));
    const result = buildReceiptProof(items, 128, 0);
    const [index, , nodes] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "bytes[]" }], result.proof,
    );
    expect(index).toBe(128n);
    expect(nodes.length).toBeGreaterThan(1);
    expect(keccak256(nodes[0]!)).toBe(result.receiptsRoot);
  });

  it("rejects a failed or duplicated authorization log", () => {
    const item = receipt(0, true);
    expect(() => authorizationLogIndex({ ...item, status: "reverted" }, core, creditId, actionHash, 1)).toThrow();
    expect(() => authorizationLogIndex({ ...item, logs: [...item.logs, ...item.logs] }, core, creditId, actionHash, 1)).toThrow();
    expect(() => authorizationLogIndex(item, core, creditId, actionHash, 0)).toThrow();
  });

  it("obtains the canonical execution header from Monad RPC", async () => {
    env.monadChainId = 143;
    const root = buildReceiptProof([receipt(0, true)], 0, 0).receiptsRoot;
    const fields: Hex[] = Array.from({ length: 20 }, () => "0x");
    fields[5] = root;
    fields[8] = "0x64";
    fields[11] = "0x03e8";
    const header = toRlp(fields);
    const hash = keccak256(header);
    const item = { ...receipt(0, true), blockHash: hash,
      logs: receipt(0, true).logs.map((log) => ({ ...log, blockHash: hash })) };
    const request = vi.fn(async () => header);
    vi.mocked(monadClient).mockReturnValue({
      getTransactionReceipt: async () => item,
      getChainId: async () => 143,
      getBlock: async ({ blockTag }: { blockTag?: string }) => blockTag === "finalized"
        ? { number: 103n }
        : { number: 100n, hash, receiptsRoot: root, timestamp: 1000n, transactions: [txHash] },
      getBlockReceipts: async () => [item],
      request,
    } as never);
    const proof = await fetchMonadAuthorizationProof({ txHash, core, creditId, actionHash, kind: 1 });
    expect(proof.header).toBe(header);
    expect(proof.blockHash).toBe(hash);
    expect(request).toHaveBeenCalledWith({ method: "debug_getRawHeader", params: ["0x64"] });
  });

  it("rejects a raw header that does not match the finalized execution block", async () => {
    env.monadChainId = 143;
    const item = receipt(0, true);
    vi.mocked(monadClient).mockReturnValue({
      getTransactionReceipt: async () => item,
      getChainId: async () => 143,
      getBlock: async ({ blockTag }: { blockTag?: string }) => blockTag === "finalized"
        ? { number: 103n }
        : { number: 100n, hash: blockHash, receiptsRoot: buildReceiptProof([item], 0, 0).receiptsRoot,
          timestamp: 1000n, transactions: [txHash] },
      getBlockReceipts: async () => [item],
      request: async () => toRlp(Array.from({ length: 20 }, () => "0x")),
    } as never);
    await expect(fetchMonadAuthorizationProof({ txHash, core, creditId, actionHash, kind: 1 }))
      .rejects.toThrow("authorization-header-mismatch");
  });

  it("rejects a block whose reconstructed receipt root differs", async () => {
    env.monadChainId = 143;
    const item = receipt(0, true);
    vi.mocked(monadClient).mockReturnValue({
      getTransactionReceipt: async () => item,
      getChainId: async () => 143,
      getBlock: async ({ blockTag }: { blockTag?: string }) => blockTag === "finalized"
        ? { number: 103n }
        : { number: 100n, hash: blockHash, receiptsRoot: `0x${"66".repeat(32)}`, transactions: [txHash] },
      getBlockReceipts: async () => [item],
    } as never);
    await expect(fetchMonadAuthorizationProof({
      txHash, core, creditId, actionHash, kind: 1,
    })).rejects.toThrow("authorization-receipts-root-mismatch");
  });

  it("waits for the later finalized block that verifies Monad execution", async () => {
    env.monadChainId = 143;
    const item = receipt(0, true);
    const getBlockReceipts = vi.fn(async () => [item]);
    vi.mocked(monadClient).mockReturnValue({
      getTransactionReceipt: async () => item,
      getChainId: async () => 143,
      getBlock: async ({ blockTag }: { blockTag?: string }) => blockTag === "finalized"
        ? { number: 102n }
        : { number: 100n, hash: blockHash, receiptsRoot: buildReceiptProof([item], 0, 0).receiptsRoot, transactions: [txHash] },
      getBlockReceipts,
    } as never);
    await expect(fetchMonadAuthorizationProof({
      txHash, core, creditId, actionHash, kind: 1,
    })).rejects.toThrow("authorization-not-verified");
    expect(getBlockReceipts).not.toHaveBeenCalled();
  });

  it("rejects chains without the pinned Monad execution delay", async () => {
    env.monadChainId = 999;
    vi.mocked(monadClient).mockReturnValue({
      getTransactionReceipt: async () => receipt(0, true),
      getChainId: async () => 999,
    } as never);
    await expect(fetchMonadAuthorizationProof({
      txHash, core, creditId, actionHash, kind: 1,
    })).rejects.toThrow("authorization-monad-chain-unsupported");
  });

  it("rejects a different supported Monad network from the configured chain", async () => {
    env.monadChainId = 143;
    vi.mocked(monadClient).mockReturnValue({
      getTransactionReceipt: async () => receipt(0, true),
      getChainId: async () => 10143,
    } as never);
    await expect(fetchMonadAuthorizationProof({
      txHash, core, creditId, actionHash, kind: 1,
    })).rejects.toThrow("authorization-monad-chain-unsupported");
  });
});
