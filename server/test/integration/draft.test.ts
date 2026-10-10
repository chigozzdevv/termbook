import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, keccak256, parseAbi } from "viem";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));

import { monadClient } from "../../src/chain/monad.client.js";
import { env } from "../../src/config/env.js";
import { inspectIntegrationDraft } from "../../src/integration/integration.draft.js";
import { clearVerifiedSourceCache } from "../../src/integration/integration.source.js";

const core = `0x${"11".repeat(20)}` as const;
const target = `0x${"22".repeat(20)}` as const;
const account = `0x${"33".repeat(20)}` as const;
const router = `0x${"99".repeat(20)}` as const;
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
const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

function chain(options: { proxyWord?: `0x${string}`; transactionTo?: `0x${string}`;
  transactionInput?: `0x${string}`; transactionValue?: bigint; trace?: unknown; historicalCode?: `0x${string}` } = {}) {
  return {
    getChainId: vi.fn(async () => 143),
    getBlock: vi.fn(async ({ blockTag }: { blockTag?: string }) =>
      blockTag === "finalized" ? { number: 100n } : { hash: blockHash }),
    getBytecode: vi.fn(async ({ blockNumber }: { blockNumber?: bigint }) =>
      blockNumber === 20n ? options.historicalCode ?? code : code),
    getStorageAt: vi.fn(async ({ slot }: { slot: string }) => slot === implementationSlot
      ? options.proxyWord ?? `0x${"00".repeat(32)}` : `0x${"00".repeat(32)}`),
    getTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 20n,
      transactionHash: txHash, blockHash, to: options.transactionTo ?? core, logs: [] })),
    getTransaction: vi.fn(async () => ({ hash: txHash, blockHash,
      to: options.transactionTo ?? core, input: options.transactionInput ?? input, value: options.transactionValue ?? 0n })),
    request: vi.fn(async () => options.trace),
  };
}

beforeEach(() => {
  clearVerifiedSourceCache();
  env.core = core;
  env.monadChainId = 143;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const address = new URL(url).pathname.split("/").at(-1)!;
    return new Response(JSON.stringify({ runtimeMatch: "exact_match", chainId: "143", address,
      matchId: "1", runtimeBytecode: { onchainBytecode: code },
      compilation: { compilerVersion: "v0.8.24", fullyQualifiedName: "App.sol:App" },
      sources: { "App.sol": { content: "contract App {}" } }, abi: parseAbi([signature]) }), { status: 200 });
  }));
});

afterEach(() => {
  Object.assign(env, previous);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("integration draft import", () => {
  it("reads a finalized deployment and its actual Core action call", async () => {
    vi.mocked(monadClient).mockReturnValue(chain() as never);
    const result = await inspectIntegrationDraft(request);
    expect(result.entries[0]).toMatchObject({ target, selector: appData.slice(0, 10),
      source: { matchId: "1", compilerVersion: "v0.8.24", files: ["App.sol"] },
      reference: { creditId, txHash, callData: appData, kind: "termbook", blockNumber: "20" } });
  });

  it("preserves native value on a finalized payable application call", async () => {
    const payable = "function deposit() payable";
    const call = encodeFunctionData({ abi: parseAbi([payable]), functionName: "deposit" });
    vi.mocked(monadClient).mockReturnValue(chain({ transactionTo: target, transactionInput: call, transactionValue: 10n ** 18n }) as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runtimeMatch: "exact_match", chainId: "143", address: target,
      matchId: "1", runtimeBytecode: { onchainBytecode: code }, compilation: { compilerVersion: "v0.8.24", fullyQualifiedName: "App.sol:App" },
      sources: { "App.sol": { content: "contract App {}" } }, abi: parseAbi([payable]) }), { status: 200 })));
    const result = await inspectIntegrationDraft({ entries: [{ ...request.entries[0]!, signature: payable }] });
    expect(result.entries[0]!.reference.nativeValue).toBe("1000000000000000000");
  });
  it("imports an application's own finalized trade as a draft reference", async () => {
    const client = chain({ transactionTo: target, transactionInput: appData });
    vi.mocked(monadClient).mockReturnValue(client as never);
    const result = await inspectIntegrationDraft(request);
    expect(result.entries[0]?.reference).toMatchObject({
      creditId: null, callData: appData, kind: "application", functionName: "placeOrder",
    });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("imports one nested app call from a canonical router transaction", async () => {
    const routerInput = "0x12345678" as const;
    const client = chain({ transactionTo: router, transactionInput: routerInput,
      trace: { type: "CALL", to: router, input: routerInput,
        calls: [{ type: "CALL", to: target, input: appData }] } });
    vi.mocked(monadClient).mockReturnValue(client as never);
    const result = await inspectIntegrationDraft(request);
    expect(result.entries[0]?.reference).toMatchObject({
      creditId: null, callData: appData, kind: "nested", functionName: "placeOrder",
    });
  });

  it("rejects a router sample that called the proposed target more than once", async () => {
    const routerInput = "0x12345678" as const;
    vi.mocked(monadClient).mockReturnValue(chain({ transactionTo: router, transactionInput: routerInput,
      trace: { type: "CALL", to: router, input: routerInput,
        calls: [{ type: "CALL", to: target, input: appData },
          { type: "CALL", to: target, input: appData }] } }) as never);
    await expect(inspectIntegrationDraft(request)).rejects.toThrow("integration-draft-reference-ambiguous");
  });

  it("rejects a sample from an older implementation", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ transactionTo: target, transactionInput: appData,
      historicalCode: "0x5678" }) as never);
    await expect(inspectIntegrationDraft(request)).rejects.toThrow("integration-draft-reference-invalid");
  });

  it("requires an explicitly reviewed implementation for an EIP-1967 proxy", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ proxyWord: `0x${"00".repeat(12)}${"77".repeat(20)}` }) as never);
    await expect(inspectIntegrationDraft(request)).rejects.toThrow("integration-draft-proxy-mismatch");
  });

  it("imports both the proxy and implementation source", async () => {
    vi.mocked(monadClient).mockReturnValue(chain({ proxyWord: `0x${"00".repeat(12)}${"77".repeat(20)}` }) as never);
    const result = await inspectIntegrationDraft({ entries: [{ ...request.entries[0]!,
      implementationCodeHash: keccak256(code) }] });
    expect(result.entries[0]).toMatchObject({
      implementation: `0x${"77".repeat(20)}`,
      source: { address: target },
      implementationSource: { address: `0x${"77".repeat(20)}` },
    });
  });

  it("rejects a source record that does not match the finalized deployment", async () => {
    vi.mocked(monadClient).mockReturnValue(chain() as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runtimeMatch: "match",
      chainId: "143", address: target, matchId: "1", runtimeBytecode: { onchainBytecode: code },
      compilation: { compilerVersion: "v0.8.24", fullyQualifiedName: "App.sol:App" },
      sources: { "App.sol": { content: "contract App {}" } }, abi: parseAbi([signature]) }), { status: 200 })));
    await expect(inspectIntegrationDraft(request)).rejects.toThrow("integration-source-unverified");
  });

  it("rejects a source ABI that cannot encode the observed action", async () => {
    vi.mocked(monadClient).mockReturnValue(chain() as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runtimeMatch: "exact_match",
      chainId: "143", address: target, matchId: "1", runtimeBytecode: { onchainBytecode: code },
      compilation: { compilerVersion: "v0.8.24", fullyQualifiedName: "App.sol:App" },
      sources: { "App.sol": { content: "contract App {}" } },
      abi: parseAbi(["function withdraw(uint256 amount)"]) }), { status: 200 })));
    await expect(inspectIntegrationDraft(request)).rejects.toThrow("integration-source-selector-mismatch");
  });
});
