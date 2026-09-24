import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, keccak256, parseAbi } from "viem";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

import { monadClient } from "../../src/chain/monad.client.js";
import { env } from "../../src/config/env.js";
import { inspectIntegrationDraft } from "../../src/integration/integration.draft.js";

const core = `0x${"11".repeat(20)}` as const;
const target = `0x${"22".repeat(20)}` as const;
const account = `0x${"33".repeat(20)}` as const;
const creditId = `0x${"44".repeat(32)}` as const;
const txHash = `0x${"55".repeat(32)}` as const;
const blockHash = `0x${"66".repeat(32)}` as const;
const code = "0x1234" as const;
const signature = "function placeOrder(uint256 amount,address account)";
const appData = encodeFunctionData({ abi: parseAbi([signature]), functionName: "placeOrder", args: [100n, account] });
const input = encodeFunctionData({ abi: parseAbi([
  "function executeAction(bytes32,address,bytes,uint256,uint256,uint256,uint256,bytes)",
]), functionName: "executeAction", args: [creditId, target, appData, 100n, 100n, 1n, 1000n, "0x12"] });
const request = { entries: [{ target, codeHash: keccak256(code), signature, txHash }] };
const previous = { core: env.core, monadChainId: env.monadChainId };

function chain(proxyWord?: `0x${string}`) {
  return {
    getChainId: vi.fn(async () => 143),
    getBlock: vi.fn(async ({ blockTag }: { blockTag?: string }) =>
      blockTag === "finalized" ? { number: 100n } : { hash: blockHash }),
    getBytecode: vi.fn(async () => code),
    getStorageAt: vi.fn(async () => proxyWord ?? `0x${"00".repeat(32)}`),
    getTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 20n,
      transactionHash: txHash, blockHash, to: core, logs: [] })),
    getTransaction: vi.fn(async () => ({ hash: txHash, blockHash, to: core, input })),
  };
}

beforeEach(() => {
  env.core = core;
  env.monadChainId = 143;
});

afterEach(() => {
  Object.assign(env, previous);
  vi.clearAllMocks();
});

describe("integration draft import", () => {
  it("reads a finalized deployment and its actual Core action call", async () => {
    vi.mocked(monadClient).mockReturnValue(chain() as never);
    const result = await inspectIntegrationDraft(request);
    expect(result.entries[0]).toMatchObject({ target, selector: appData.slice(0, 10),
      reference: { creditId, txHash, callData: appData, blockNumber: "20" } });
  });

  it("requires an explicitly reviewed implementation for an EIP-1967 proxy", async () => {
    vi.mocked(monadClient).mockReturnValue(chain(`0x${"00".repeat(12)}${"77".repeat(20)}`) as never);
    await expect(inspectIntegrationDraft(request)).rejects.toThrow("integration-draft-proxy-mismatch");
  });
});
