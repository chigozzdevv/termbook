import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, keccak256, toRlp, type Hex } from "viem";
import { env } from "../../src/config/env.js";
import { monadClient } from "../../src/chain/monad.client.js";
import {
  buildEthereumSourceHeader, encodeEthereumExecutionHeader, packageEthereumHeader,
} from "../../src/chain/ethereum-execution-header.js";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

const word = (byte: string) => `0x${byte.repeat(32)}` as Hex;
const root = word("bb");
const registry = `0x${"12".repeat(20)}` as const;
const verifier = `0x${"34".repeat(20)}` as const;
const beacon = `0x${"56".repeat(20)}` as const;
const originalCore = env.core;

function block(withRequests = true) {
  const fields = [
    word("11"), word("22"), `0x${"33".repeat(20)}` as Hex, word("44"), word("55"), word("66"),
    `0x${"00".repeat(256)}` as Hex, "0x" as Hex, "0x01" as Hex, "0x989680" as Hex,
    "0x5208" as Hex, "0x65" as Hex, "0x1234" as Hex, word("77"),
    `0x${"00".repeat(8)}` as Hex, "0x01" as Hex, word("88"), "0x" as Hex,
    "0x" as Hex, word("99"),
  ];
  if (withRequests) fields.push(word("aa"));
  const rlp = toRlp(fields);
  return {
    hash: keccak256(rlp), parentHash: word("11"), sha3Uncles: word("22"),
    miner: `0x${"33".repeat(20)}`, stateRoot: word("44"), transactionsRoot: word("55"),
    receiptsRoot: word("66"), logsBloom: `0x${"00".repeat(256)}`, difficulty: "0x0",
    number: "0x1", gasLimit: "0x989680", gasUsed: "0x5208", timestamp: "0x65",
    extraData: "0x1234", mixHash: word("77"), nonce: `0x${"00".repeat(8)}`,
    baseFeePerGas: "0x1", withdrawalsRoot: word("88"), blobGasUsed: "0x0",
    excessBlobGas: "0x0", parentBeaconBlockRoot: word("99"),
    ...(withRequests ? { requestsHash: word("aa") } : {}),
    rlp,
  };
}

afterEach(() => {
  env.core = originalCore;
  vi.resetAllMocks();
});

describe("Ethereum execution header producer", () => {
  it.each([true, false])("builds and hashes the contiguous fork header, requests=%s", (withRequests) => {
    const rpc = block(withRequests);
    const encoded = encodeEthereumExecutionHeader(rpc);
    expect(encoded.rlp).toBe(rpc.rlp);
    expect(encoded.blockHash).toBe(rpc.hash);
    expect(encoded.stateRoot).toBe(rpc.stateRoot);
    expect(encoded.receiptsRoot).toBe(rpc.receiptsRoot);
    expect(encoded.timestamp).toBe(101n);
    expect(encoded.fieldCount).toBe(withRequests ? 21 : 20);
    const [raw, consensus] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes" }],
      packageEthereumHeader(encoded, root));
    const [beaconRoot] = decodeAbiParameters([{ type: "bytes32" }], consensus);
    expect([raw, beaconRoot]).toEqual([rpc.rlp, root]);
  });

  it("rejects tampered roots, missing fork fields, malformed quantities, and later forks", () => {
    const rpc = block();
    expect(() => encodeEthereumExecutionHeader({ ...rpc, stateRoot: word("cc") }))
      .toThrow("source-header-hash-mismatch");
    expect(() => encodeEthereumExecutionHeader({ ...rpc, receiptsRoot: word("00") }))
      .toThrow("source-header-invalid");
    expect(() => encodeEthereumExecutionHeader({ ...rpc, excessBlobGas: undefined }))
      .toThrow("source-header-invalid");
    expect(() => encodeEthereumExecutionHeader({ ...rpc, gasUsed: "0x05208" }))
      .toThrow("source-header-invalid");
    expect(() => encodeEthereumExecutionHeader({ ...rpc, blockAccessListHash: word("dd") }))
      .toThrow("source-header-unsupported");
  });

  it("requires the active Monad verifier to accept the Beacon root", async () => {
    env.core = `0x${"ab".repeat(20)}`;
    const rpc = block();
    const readContract = vi.fn()
      .mockResolvedValueOnce(registry)
      .mockResolvedValueOnce([verifier, 1n, true, 86_400n, word("cc")])
      .mockResolvedValueOnce(beacon)
      .mockResolvedValueOnce([rpc.hash, 8n])
      .mockResolvedValueOnce(5n)
      .mockResolvedValueOnce(true);
    vi.mocked(monadClient).mockReturnValue({ readContract } as never);
    const header = await buildEthereumSourceHeader(rpc, root);
    expect(readContract).toHaveBeenCalledTimes(6);
    expect(readContract.mock.calls[3]?.[0]).toMatchObject({ address: beacon,
      functionName: "finalizedExecution", args: [root] });
    expect(readContract.mock.calls[5]?.[0]).toMatchObject({ address: verifier,
      functionName: "verifyFinality", args: [header] });
    const [, consensus] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], header);
    expect(decodeAbiParameters([{ type: "bytes32" }], consensus)[0]).toBe(root);
  });

  it("rejects an unrecorded root even when RPC marks the block finalized", async () => {
    env.core = `0x${"ab".repeat(20)}`;
    const readContract = vi.fn()
      .mockResolvedValueOnce(registry)
      .mockResolvedValueOnce([verifier, 1n, true, 86_400n, word("cc")])
      .mockResolvedValueOnce(beacon)
      .mockResolvedValueOnce([word("00"), 0n])
      .mockResolvedValueOnce(5n);
    vi.mocked(monadClient).mockReturnValue({ readContract } as never);
    const rpc = block();
    await expect(buildEthereumSourceHeader(rpc, root)).rejects.toThrow("source-header-anchor-unavailable");
    expect(readContract).toHaveBeenCalledTimes(5);
  });

  it("uses the historical Beacon admission rule only for receipt events", async () => {
    env.core = `0x${"ab".repeat(20)}`;
    const rpc = block();
    const readContract = vi.fn()
      .mockResolvedValueOnce(registry)
      .mockResolvedValueOnce([verifier, 1n, true, 86_400n, word("cc")])
      .mockResolvedValueOnce(beacon)
      .mockResolvedValueOnce([rpc.hash, 8n])
      .mockResolvedValueOnce(5n)
      .mockResolvedValueOnce(true);
    vi.mocked(monadClient).mockReturnValue({ readContract } as never);
    const header = await buildEthereumSourceHeader(rpc, root, { historicalEvent: true });
    expect(readContract.mock.calls[5]?.[0]).toMatchObject({ address: beacon,
      functionName: "verifyHistoricalFinality", args: [header] });
  });

  it("rejects a recorded root when the configured verifier does not admit the header", async () => {
    env.core = `0x${"ab".repeat(20)}`;
    const rpc = block();
    const readContract = vi.fn()
      .mockResolvedValueOnce(registry)
      .mockResolvedValueOnce([verifier, 1n, true, 86_400n, word("cc")])
      .mockResolvedValueOnce(beacon)
      .mockResolvedValueOnce([rpc.hash, 8n])
      .mockResolvedValueOnce(5n)
      .mockResolvedValueOnce(false);
    vi.mocked(monadClient).mockReturnValue({ readContract } as never);
    await expect(buildEthereumSourceHeader(rpc, root)).rejects.toThrow("source-header-anchor-unavailable");
  });
});
