import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, decodeFunctionData, parseAbi } from "viem";
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/collateral/remote-action.js", () => ({ readAuthorizedAction: vi.fn(), hashRemoteAction: vi.fn(), serializeAction: vi.fn() }));
vi.mock("../../src/collateral/remote-action.service.js", () => ({ verifyAuthorizationReceipt: vi.fn() }));
vi.mock("../../src/chain/monad-wormhole.js", () => ({ currentEthereumAuthorization: vi.fn() }));
vi.mock("../../src/chain/ethereum-wormhole-snapshot.js", () => ({ fetchEthereumSnapshot: vi.fn() }));
vi.mock("viem", async (original) => ({ ...await original<typeof import("viem")>(), createPublicClient: vi.fn() }));
import { createPublicClient } from "viem";
import { monadClient } from "../../src/chain/monad.client.js";
import { hashRemoteAction, readAuthorizedAction, serializeAction } from "../../src/collateral/remote-action.js";
import { currentEthereumAuthorization } from "../../src/chain/monad-wormhole.js";
import { fetchEthereumSnapshot } from "../../src/chain/ethereum-wormhole-snapshot.js";
import { topUpService } from "../../src/collateral/topup.service.js";
import { env } from "../../src/config/env.js";
const hex = (s: string, n = 64) => `0x${s.repeat(n)}` as `0x${string}`;
const core = hex("1", 40), vault = hex("2", 40), controller = hex("3", 40), asset = hex("4", 40);
const verifier = hex("5", 40), owner = hex("6", 40), creditId = hex("7"), actionHash = hex("8"), auth = hex("9");
const code = "0x1234", codeHash = keccak256(code);
const old = { evmSourceRpcUrls: env.evmSourceRpcUrls, monadChainId: env.monadChainId, sourceRpcUrl: env.sourceRpcUrl, wormholeScanUrl: env.wormholeScanUrl,
  sourceWormholePublisherKey: env.sourceWormholePublisherKey, core: env.core };
let consumed = true;
let sourceCode = code;
let proofAccepted = true;
let call = vi.fn();
beforeEach(() => {
  consumed = true; sourceCode = code; proofAccepted = true; call = vi.fn(async () => ({}));
  env.monadChainId = 143; env.core = core; env.sourceRpcUrl = "https://eth.example"; env.wormholeScanUrl = "https://scan.example";
  env.sourceWormholePublisherKey = hex("a");
  vi.mocked(readAuthorizedAction).mockResolvedValue({ action: { monadCore: core, monadChain: 143n,
    sourceChain: 1n, sourceVault: vault, asset, creditId, lockId: hex("b"), kind: 2, recipient: owner,
    amount: 20n, nonce: 1n, deadline: 2000n }, actionHash, collateralAmount: 100n });
  vi.mocked(hashRemoteAction).mockReturnValue(actionHash);
  vi.mocked(serializeAction).mockReturnValue({} as never);
  vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 10n }), getCode: async () => code, call,
    readContract: async ({ functionName }: { functionName: string }) => ({ creditDetails: { collateralVault: vault,
      verifierVersion: 1n, verifierCodeHash: codeHash }, verifierRegistry: hex("c", 40), verifiers: [verifier, 1n, true, 0n, codeHash],
      sourceVault: vault, sourceController: controller, sourceControllerCodeHash: codeHash,
      verifyAppliedAction: proofAccepted, verifyUnconsumedAction: proofAccepted })[functionName] } as never);
  vi.mocked(createPublicClient).mockReturnValue({ getChainId: async () => 1, getBlock: async () => ({ number: 10n }),
    getCode: async () => sourceCode, readContract: async ({ functionName }: { functionName: string }) => ({
      core: controller, asset, chainId_: 1n, vault, monadCore: core, monadChain: 143n, verifier,
      consumed, wormholeMode: true, verifyEvent: true })[functionName] } as never);
  vi.mocked(currentEthereumAuthorization).mockResolvedValue({ header: "0xcc", proof: "0xdd" } as never);
  vi.mocked(fetchEthereumSnapshot).mockResolvedValue({ header: "0xcc", proof: "0xdd" } as never);
});
afterEach(() => { Object.assign(env, old); vi.clearAllMocks(); });
describe("Ethereum top-up proof plans", () => {
  it("binds source funding to the admitted controller and authorization", async () => {
    const plan = await topUpService.plan({ creditId, authorizationTxHash: auth }, owner);
    expect(plan.actionHash).toBe(actionHash);
    expect(plan.consumed).toBe(true);
    expect(plan.transaction.to).toBe(controller);
    expect(currentEthereumAuthorization).toHaveBeenCalledWith({ core, creditId, actionHash, kind: 2 });
  });
  it("rejects changed controller bytecode before preparing a funding call", async () => {
    sourceCode = "0x5678";
    await expect(topUpService.plan({ creditId, authorizationTxHash: auth }, owner)).rejects.toThrow("source-controller-code-mismatch");
    expect(currentEthereumAuthorization).not.toHaveBeenCalled();
  });
  it("proves an already consumed action after a lost source transaction response", async () => {
    const plan = await topUpService.confirmation({ creditId, mode: "apply" }, owner);
    const decoded = decodeFunctionData({ abi: parseAbi(["function confirmCollateralTopUp(bytes32,bytes,bytes)"]), data: plan.data });
    expect(decoded.args).toEqual([creditId, "0xcc", "0xdd"]);
    expect(fetchEthereumSnapshot).toHaveBeenCalledWith({ sourceChain: 1n, verifier, vault, controller, kind: 2, digest: actionHash });
    expect(call).toHaveBeenCalledWith({ account: owner, to: core, data: plan.data });
  });
  it("requires an applied action before requesting an application proof", async () => {
    consumed = false;
    await expect(topUpService.confirmation({ creditId, mode: "apply" }, owner)).rejects.toThrow("source-action-not-applied");
    expect(fetchEthereumSnapshot).not.toHaveBeenCalled();
  });
  it("requires verified nonexecution before cancelling an expired authorization", async () => {
    proofAccepted = false;
    await expect(topUpService.confirmation({ creditId, mode: "expire" }, owner)).rejects.toThrow("source-action-proof-rejected");
    expect(fetchEthereumSnapshot).toHaveBeenCalledWith({ sourceChain: 1n, verifier, vault, controller, kind: 3, digest: actionHash, deadline: 2000n });
    expect(call).not.toHaveBeenCalled();
  });
});

it("prepares a Base top-up using the Base endpoint and admitted source identity", async () => {
  env.evmSourceRpcUrls = '{"8453":"https://base.example"}';
  const prepared = await readAuthorizedAction(creditId, 2);
  vi.mocked(readAuthorizedAction).mockResolvedValue({ ...prepared, action: { ...prepared.action, sourceChain: 8453n } });
  vi.mocked(createPublicClient).mockReturnValue({ getChainId: async () => 8453, getBlock: async () => ({ number: 10n }),
    getCode: async () => code, readContract: async ({ functionName }: { functionName: string }) => ({
      core: controller, asset, chainId_: 8453n, vault, monadCore: core, monadChain: 143n, verifier,
      consumed, wormholeMode: true, verifyEvent: true })[functionName] } as never);
  const plan = await topUpService.plan({ creditId, authorizationTxHash: auth }, owner);
  expect(plan.transaction.to).toBe(controller);
  expect(plan.actionHash).toBe(actionHash);
});
