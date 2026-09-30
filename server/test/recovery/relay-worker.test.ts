import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, keccak256, parseAbi } from "viem";
import { runRecoveryRelayWorker } from "../../src/recovery/relay.worker.js";
import { keeperTransaction } from "../../src/chain/keeper.js";
import { fetchEthereumSnapshot } from "../../src/chain/ethereum-wormhole-snapshot.js";
import { fetchWormholeVaaById } from "../../src/chain/wormhole-vaa.js";

const mocks = vi.hoisted(() => ({ monad: vi.fn(), source: vi.fn(), find: vi.fn(), update: vi.fn(), warn: vi.fn() }));
const address = (byte: string) => `0x${byte.repeat(40)}` as `0x${string}`;
const word = (byte: string) => `0x${byte.repeat(64)}` as `0x${string}`;
const factory = address("1"), core = address("2"), sourceVault = address("3"), inbox = address("4"), house = address("5");
const op = word("6"), credit = word("7"), digest = word("8");
const delivered = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }], [op, digest, inbox]));
vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 143, rpcUrl: "http://localhost",
  sourceRpcUrl: "http://localhost", settlementFactory: `0x${"1".repeat(40)}`, core: `0x${"2".repeat(40)}` } }));
vi.mock("../../src/recovery/relay.config.js", () => ({ recoveryRelayConfig: () => ({
  monad: { address: `0x${"a".repeat(40)}` }, ethereum: { address: `0x${"b".repeat(40)}` },
}) }));
vi.mock("../../src/settlement/settlement.model.js", () => ({ SettlementModel: { find: mocks.find, updateOne: mocks.update } }));
vi.mock("../../src/logging/logger.js", () => ({ logger: { warn: mocks.warn } }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn() }));
vi.mock("../../src/chain/ethereum-wormhole-snapshot.js", () => ({ fetchEthereumSnapshot: vi.fn() }));
vi.mock("../../src/chain/wormhole-vaa.js", () => ({ fetchWormholeVaaById: vi.fn() }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: () => ({ getChainId: async () => 143,
  getBlock: async () => ({ number: 100n, timestamp: 11000n }), readContract: mocks.monad, call: vi.fn() }) }));
vi.mock("viem", async (load) => ({ ...await load<typeof import("viem")>(), createPublicClient: () => ({
  getChainId: async () => 1, getBlock: async () => ({ number: 200n, timestamp: 11000n }),
  readContract: mocks.source, call: vi.fn(),
}) }));
let published: bigint, settled: boolean, amount: bigint, pending: boolean;
beforeEach(() => {
  vi.resetAllMocks(); published = 0n; settled = false; amount = 300n; pending = true;
  mocks.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [{
    operationId: op, creditId: credit, inbox, vault: house, sourceRefundRecipient: sourceVault,
  }] }) }) });
  mocks.monad.mockImplementation(async ({ functionName }: { functionName: string }) => ({
    creditId: credit, vault: house, operationDigestOf: digest, recoveryCancelled: false, recoverySettled: settled,
    applied: 350n, refunded: 0n, minOut: 350n, available: 0n, recoverySettlementPublishedAt: published,
    ethereumWormholeCore: address("a"), messageFee: 10n, recoverySettlementSequence: 9n,
    verifierRegistry: address("b"), verifiers: [address("c")], sourceVault: address("d"),
  })[functionName]);
  mocks.source.mockImplementation(async ({ functionName }: { functionName: string }) => ({
    operationPending: pending, inFlight: [credit, amount], monadFactory: factory, monadChain: 143n,
    controller: address("e"), verifier: address("f"), deliveryDigest: delivered, proofMaxAge: 7200n,
  })[functionName]);
  vi.mocked(keeperTransaction).mockResolvedValue("pending");
  vi.mocked(fetchWormholeVaaById).mockResolvedValue({ header: "0x1234", proof: "0x" });
  vi.mocked(fetchEthereumSnapshot).mockResolvedValue({ header: "0x5678", proof: "0x", blockHash: word("a") });
});
const abi = parseAbi([
  "function publishEthereumRecoverySettlement(bytes32)", "function confirmDelivery(bytes32,bytes,bytes)",
  "function cancelRefundedRecoveryOperation(bytes32,bytes32,bytes,bytes)",
]);

describe("remote recovery completion relay", () => {
  it("publishes a destination settlement separately from route registration", async () => {
    expect(await runRecoveryRelayWorker()).toBe(1);
    const request = vi.mocked(keeperTransaction).mock.calls[0]![0];
    expect(request).toMatchObject({ chainId: 143, to: factory, value: 10n });
    expect(decodeFunctionData({ abi, data: request.data })).toMatchObject({
      functionName: "publishEthereumRecoverySettlement", args: [op],
    });
    expect(fetchWormholeVaaById).not.toHaveBeenCalled();
  });

  it("confirms source delivery only with the exact destination settlement VAA", async () => {
    published = 10000n; settled = true;
    expect(await runRecoveryRelayWorker()).toBe(1);
    expect(fetchWormholeVaaById).toHaveBeenCalledWith(expect.objectContaining({ chain: 48, emitter: factory, sequence: 9n }));
    const request = vi.mocked(keeperTransaction).mock.calls[0]![0];
    expect(request).toMatchObject({ chainId: 1, to: sourceVault });
    expect(decodeFunctionData({ abi, data: request.data })).toMatchObject({
      functionName: "confirmDelivery", args: [op, "0x1234", "0x"],
    });
  });

  it("reconciles a fully refunded source operation using its bound proof", async () => {
    amount = 0n; pending = false;
    expect(await runRecoveryRelayWorker()).toBe(1);
    expect(fetchEthereumSnapshot).toHaveBeenCalledWith(expect.objectContaining({ kind: 5, operationId: op }));
    const request = vi.mocked(keeperTransaction).mock.calls[0]![0];
    expect(request).toMatchObject({ chainId: 143, to: core });
    expect(decodeFunctionData({ abi, data: request.data })).toMatchObject({
      functionName: "cancelRefundedRecoveryOperation", args: [credit, op, "0x5678", "0x"],
    });
  });

  it("rejects a route whose source custody points at another factory", async () => {
    mocks.source.mockResolvedValue(address("9"));
    expect(await runRecoveryRelayWorker()).toBe(0);
    expect(keeperTransaction).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ operationId: op }, expect.anything());
  });
});
