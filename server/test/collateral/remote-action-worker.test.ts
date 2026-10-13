import { beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, type Hex } from "viem";

vi.mock("../../src/chain/keeper-funding.js", () => ({ assertKeeperFunding: vi.fn(), assertSignedKeeperFunding: vi.fn() }));
vi.mock("../../src/chain/monad-receipt-proof.js", () => ({ fetchMonadAuthorizationProof: vi.fn() }));
vi.mock("../../src/chain/source.client.js", () => ({ fetchConsumedActionProof: vi.fn() }));
vi.mock("../../src/chain/ethereum-wormhole-snapshot.js", () => ({ ethereumWormholeMode: vi.fn(), fetchEthereumSnapshot: vi.fn() }));
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/ethereum-confirmations.js", () => ({ ethereumCreditConfirmationPolicy: vi.fn(), ethereumConfirmedBlock: vi.fn() }));
vi.mock("../../src/collateral/remote-action.repo.js", () => ({
  remoteActionRepo: {
    find: vi.fn(), acquireSigner: vi.fn(), releaseSigner: vi.fn(), prepare: vi.fn(), prepareConfirmation: vi.fn(),
    state: vi.fn(), confirmationState: vi.fn(), finalizeWithoutConfirmation: vi.fn(), listPending: vi.fn(),
  },
}));
vi.mock("../../src/collateral/remote-action.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/collateral/remote-action.js")>(), readAuthorizedAction: vi.fn(),
}));
vi.mock("../../src/collateral/remote-action.service.js", () => ({ verifySeizureOperation: vi.fn() }));
vi.mock("viem/accounts", () => ({ privateKeyToAccount: () => ({ address: `0x${"aa".repeat(20)}` }) }));
vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(), createPublicClient: vi.fn(), createWalletClient: vi.fn(),
}));

import { createPublicClient, createWalletClient } from "viem";
import { fetchMonadAuthorizationProof } from "../../src/chain/monad-receipt-proof.js";
import { fetchConsumedActionProof } from "../../src/chain/source.client.js";
import { ethereumWormholeMode, fetchEthereumSnapshot } from "../../src/chain/ethereum-wormhole-snapshot.js";
import { monadClient } from "../../src/chain/monad.client.js";
import { ethereumCreditConfirmationPolicy, ethereumConfirmedBlock } from "../../src/chain/ethereum-confirmations.js";
import { env } from "../../src/config/env.js";
import { remoteActionRepo } from "../../src/collateral/remote-action.repo.js";
import { hashRemoteAction, readAuthorizedAction, serializeAction, type RemoteAction } from "../../src/collateral/remote-action.js";
import { handleRemoteActionJob } from "../../src/collateral/remote-action.worker.js";

const action: RemoteAction = {
  monadChain: 10143n, monadCore: `0x${"11".repeat(20)}`,
  sourceChain: 11155111n, sourceVault: `0x${"22".repeat(20)}`,
  creditId: `0x${"33".repeat(32)}`, lockId: `0x${"44".repeat(32)}`,
  asset: `0x${"55".repeat(20)}`, kind: 0, recipient: `0x${"66".repeat(20)}`,
  amount: 100n, nonce: 1n, deadline: (2n ** 256n) - 1n,
};
const actionHash = hashRemoteAction(action);
const controller = `0x${"77".repeat(20)}`;
const verifier = `0x${"88".repeat(20)}`;
const rawTx = "0x1234" as Hex;

function fakeMonad() {
  const code = "0x1234" as const;
  const codeHash = keccak256(code);
  return {
    getChainId: vi.fn().mockResolvedValue(Number(action.monadChain)),
    getBlock: vi.fn().mockResolvedValue({ number: 200n }),
    readContract: vi.fn().mockImplementation(async ({ functionName }: { functionName: string }) => ({
      pendingRemoteReturn: action.amount, remoteReturnActionHash: actionHash,
      creditDetails: { collateralVault: action.sourceVault, lockId: action.lockId, collateralAsset: action.asset,
        verifierVersion: 1n, verifierCodeHash: codeHash },
      verifierRegistry: `0x${"ab".repeat(20)}`, verifiers: [verifier, 1n, true, 0n, codeHash], verifyEvent: true,
      sourceVault: action.sourceVault, sourceController: controller,
      sourceControllerCodeHash: `0x${"aa".repeat(32)}`, verifyAppliedAction: true,
    })[functionName]),
    getCode: vi.fn().mockResolvedValue(code), simulateContract: vi.fn().mockResolvedValue({}),
    getTransactionCount: vi.fn().mockResolvedValue(4), sendRawTransaction: vi.fn(),
  };
}

function fakeSource() {
  return {
    getChainId: vi.fn().mockResolvedValue(11155111),
    getBlock: vi.fn().mockResolvedValue({ number: 100n, timestamp: 1_000_000n }),
    readContract: vi.fn().mockImplementation(async ({ functionName }: { functionName: string }) => ({
      core: controller, asset: action.asset, chainId_: 11155111n, remoteMode: true,
      vault: action.sourceVault, monadCore: action.monadCore, monadChain: action.monadChain,
      recoveryVault: `0x${"99".repeat(20)}`, verifier, consumed: false,
      admission: [action.monadChain, 1n, `0x${"aa".repeat(32)}`], verifyEvent: true,
    })[functionName]),
    simulateContract: vi.fn().mockResolvedValue({}),
    getTransactionCount: vi.fn().mockResolvedValue(9),
    sendRawTransaction: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ethereumWormholeMode).mockResolvedValue(false);
  vi.mocked(ethereumCreditConfirmationPolicy).mockResolvedValue({ depth: 0, hash: `0x${"00".repeat(32)}`, consistency: 0 });
  vi.mocked(ethereumConfirmedBlock).mockImplementation(async (client) => client.getBlock({ blockTag: "finalized" }));
  env.sourceRpcUrl = "https://source.example";
  env.sourceBeaconApiUrl = "https://beacon.example";
  env.sourceActionKeeperKey = `0x${"01".repeat(32)}`;
  env.monadConfirmKeeperKey = `0x${"02".repeat(32)}`;
  env.monadChainId = Number(action.monadChain);
  env.core = action.monadCore;
  vi.mocked(readAuthorizedAction).mockResolvedValue({ action, actionHash, collateralAmount: 100n });
  vi.mocked(fetchMonadAuthorizationProof).mockResolvedValue({
    header: "0x12", proof: "0x34", receiptsRoot: `0x${"aa".repeat(32)}`,
    blockHash: `0x${"bb".repeat(32)}`, blockNumber: 80n, txIndex: 0, logIndex: 0,
  });
  vi.mocked(fetchConsumedActionProof).mockResolvedValue({
    header: "0x12", proof: "0x34", stateRoot: `0x${"aa".repeat(32)}`,
    blockHash: `0x${"bb".repeat(32)}`, blockNumber: "0x50",
    slot: `0x${"cc".repeat(32)}`, codeHash: `0x${"aa".repeat(32)}`,
  });
  vi.mocked(remoteActionRepo.acquireSigner).mockResolvedValue(true);
  vi.mocked(remoteActionRepo.state).mockResolvedValue({ matchedCount: 1 } as never);
});

describe("remote action relay", () => {
  it("publishes an applied snapshot after mining while keeping confirmation pending until finality", async () => {
    const source = fakeSource(), monad = fakeMonad();
    const blockHash = `0x${"bb".repeat(32)}`;
    Object.assign(source, { getTransactionReceipt: vi.fn().mockResolvedValue({
      status: "success", blockNumber: 120n, blockHash,
    }) });
    source.getBlock.mockImplementation(async (request: { blockNumber?: bigint }) => ({
      number: request.blockNumber ?? 100n, timestamp: 1_000_000n, hash: blockHash,
    }));
    vi.mocked(createPublicClient).mockReturnValue(source as never);
    vi.mocked(monadClient).mockReturnValue(monad as never);
    vi.mocked(ethereumWormholeMode).mockResolvedValue(true);
    vi.mocked(fetchEthereumSnapshot).mockRejectedValue(new Error("ethereum-wormhole-not-finalized"));
    vi.mocked(remoteActionRepo.find).mockResolvedValue({
      actionHash, creditId: action.creditId, kind: action.kind, action: serializeAction(action),
      authorizationTxHash: `0x${"cc".repeat(32)}`, state: "submitted", txHash: keccak256(rawTx), rawTx,
    } as never);
    await handleRemoteActionJob({ kind: "collateral.remote-action", payload: { actionHash } });
    expect(fetchEthereumSnapshot).toHaveBeenCalledWith({
      sourceChain: action.sourceChain, verifier, vault: action.sourceVault, controller, kind: 2, digest: actionHash,
    });
    expect(remoteActionRepo.state).toHaveBeenCalledWith(actionHash, "mined", keccak256(rawTx), { sourceBlockHash: blockHash });
    expect(remoteActionRepo.state).not.toHaveBeenCalledWith(actionHash, "source_finalized", expect.anything());
    expect(remoteActionRepo.prepareConfirmation).not.toHaveBeenCalled();
  });

  it.each(["reverted", "orphaned"])("does not publish a snapshot for a %s custody transaction", async (failure) => {
    const source = fakeSource();
    const blockHash = `0x${"bb".repeat(32)}`;
    Object.assign(source, { getTransactionReceipt: vi.fn().mockResolvedValue({
      status: failure === "reverted" ? "reverted" : "success", blockNumber: 120n, blockHash,
    }) });
    source.getBlock.mockResolvedValue({ number: 100n, timestamp: 1_000_000n,
      hash: failure === "orphaned" ? `0x${"cc".repeat(32)}` : blockHash });
    vi.mocked(createPublicClient).mockReturnValue(source as never);
    vi.mocked(remoteActionRepo.find).mockResolvedValue({
      actionHash, creditId: action.creditId, kind: action.kind, action: serializeAction(action),
      authorizationTxHash: `0x${"cc".repeat(32)}`, state: "submitted", txHash: keccak256(rawTx), rawTx,
    } as never);
    await handleRemoteActionJob({ kind: "collateral.remote-action", payload: { actionHash } });
    expect(fetchEthereumSnapshot).not.toHaveBeenCalled();
    expect(remoteActionRepo.prepareConfirmation).not.toHaveBeenCalled();
  });

  it("checks applied actions at admitted confirmation depth while retaining finalized custody bindings", async () => {
    const source = fakeSource();
    const read = source.readContract.getMockImplementation()!;
    source.readContract.mockImplementation(async (request) => request.functionName === "consumed" ? true : read(request));
    vi.mocked(createPublicClient).mockReturnValue(source as never);
    vi.mocked(ethereumCreditConfirmationPolicy).mockResolvedValue({ depth: 5, hash: `0x${"aa".repeat(32)}`, consistency: 203 });
    vi.mocked(ethereumConfirmedBlock).mockResolvedValue({ number: 150n, timestamp: 1_000_100n } as never);
    vi.mocked(remoteActionRepo.find).mockResolvedValue({ actionHash, creditId: action.creditId,
      kind: action.kind, action: serializeAction(action), authorizationTxHash: `0x${"cc".repeat(32)}`, state: "pending" } as never);
    await handleRemoteActionJob({ kind: "collateral.remote-action", payload: { actionHash } });
    expect(ethereumCreditConfirmationPolicy).toHaveBeenCalledWith(action.creditId);
    expect(ethereumConfirmedBlock).toHaveBeenCalledWith(source, 5, 203);
    const requests = source.readContract.mock.calls.map(([request]) => request as { functionName: string; blockNumber: bigint });
    expect(requests.filter((r) => r.functionName === "consumed")).toEqual([
      expect.objectContaining({ blockNumber: 150n })]);
    expect(requests.filter((r) => r.functionName !== "consumed").every((r) => r.blockNumber === 100n)).toBe(true);
    expect(remoteActionRepo.state).toHaveBeenCalledWith(actionHash, "external_execution", undefined,
      { failure: "remote-action-source-tx-required" });
    expect(createWalletClient).not.toHaveBeenCalled();
  });
  it("keeps the signer reserved when another worker wins the signed-tx CAS", async () => {
    const source = fakeSource();
    vi.mocked(createPublicClient).mockReturnValue(source as never);
    vi.mocked(createWalletClient).mockReturnValue({
      prepareTransactionRequest: vi.fn().mockResolvedValue({ nonce: 9 }),
      signTransaction: vi.fn().mockResolvedValue(rawTx),
    } as never);
    const record = {
      actionHash, creditId: action.creditId, kind: action.kind, action: serializeAction(action),
      authorizationTxHash: `0x${"cc".repeat(32)}`, state: "pending",
    };
    vi.mocked(remoteActionRepo.find)
      .mockResolvedValueOnce(record as never)
      .mockResolvedValueOnce(record as never)
      .mockResolvedValueOnce({ ...record, txHash: keccak256("0xabcd"), rawTx: "0xabcd" } as never);
    vi.mocked(remoteActionRepo.prepare).mockResolvedValue({ matchedCount: 0 } as never);

    await handleRemoteActionJob({ kind: "collateral.remote-action", payload: { actionHash } });

    expect(remoteActionRepo.prepare).toHaveBeenCalledOnce();
    expect(remoteActionRepo.releaseSigner).not.toHaveBeenCalled();
    expect(source.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects an unaccepted Monad receipt proof before reserving or signing", async () => {
    const source = fakeSource();
    source.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => ({
      core: controller, asset: action.asset, chainId_: 11155111n, remoteMode: true,
      vault: action.sourceVault, monadCore: action.monadCore, monadChain: action.monadChain,
      recoveryVault: `0x${"99".repeat(20)}`, verifier, consumed: false,
      admission: [action.monadChain, 1n, `0x${"aa".repeat(32)}`], verifyEvent: false,
    })[functionName]);
    vi.mocked(createPublicClient).mockReturnValue(source as never);
    vi.mocked(remoteActionRepo.find).mockResolvedValue({
      actionHash, creditId: action.creditId, kind: action.kind, action: serializeAction(action),
      authorizationTxHash: `0x${"cc".repeat(32)}`, state: "pending",
    } as never);

    await expect(handleRemoteActionJob({ kind: "collateral.remote-action", payload: { actionHash } }))
      .rejects.toThrow("remote-action-proof-rejected");

    expect(remoteActionRepo.acquireSigner).not.toHaveBeenCalled();
    expect(createWalletClient).not.toHaveBeenCalled();
  });

  it("keeps the Monad signer reserved when a confirmation worker wins the CAS", async () => {
    const monad = fakeMonad();
    vi.mocked(monadClient).mockReturnValue(monad as never);
    vi.mocked(createWalletClient).mockReturnValue({
      prepareTransactionRequest: vi.fn().mockResolvedValue({ nonce: 4 }),
      signTransaction: vi.fn().mockResolvedValue(rawTx),
    } as never);
    const record = {
      actionHash, creditId: action.creditId, kind: action.kind, action: serializeAction(action),
      authorizationTxHash: `0x${"cc".repeat(32)}`, state: "source_finalized",
      txHash: `0x${"dd".repeat(32)}`,
    };
    vi.mocked(remoteActionRepo.find)
      .mockResolvedValueOnce(record as never)
      .mockResolvedValueOnce(record as never)
      .mockResolvedValueOnce(record as never)
      .mockResolvedValueOnce({ ...record, confirmTxHash: keccak256("0xabcd"), confirmRawTx: "0xabcd" } as never);
    vi.mocked(remoteActionRepo.prepareConfirmation).mockResolvedValue({ matchedCount: 0 } as never);

    await handleRemoteActionJob({ kind: "collateral.remote-action", payload: { actionHash } });

    expect(remoteActionRepo.prepareConfirmation).toHaveBeenCalledOnce();
    expect(remoteActionRepo.releaseSigner).not.toHaveBeenCalled();
    expect(monad.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects a source applied proof before signing the Monad confirmation", async () => {
    const monad = fakeMonad();
    monad.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => ({
      pendingRemoteReturn: action.amount, remoteReturnActionHash: actionHash,
      creditDetails: { collateralVault: action.sourceVault, lockId: action.lockId, collateralAsset: action.asset,
        verifierVersion: 1n, verifierCodeHash: keccak256("0x1234") },
      verifierRegistry: `0x${"ab".repeat(20)}`,
      verifiers: [verifier, 1n, true, 0n, keccak256("0x1234")], verifyEvent: false,
      sourceVault: action.sourceVault, sourceController: controller,
      sourceControllerCodeHash: `0x${"aa".repeat(32)}`, verifyAppliedAction: false,
    })[functionName]);
    vi.mocked(monadClient).mockReturnValue(monad as never);
    vi.mocked(remoteActionRepo.find).mockResolvedValue({
      actionHash, creditId: action.creditId, kind: action.kind, action: serializeAction(action),
      authorizationTxHash: `0x${"cc".repeat(32)}`, state: "source_finalized",
      txHash: `0x${"dd".repeat(32)}`,
    } as never);

    await expect(handleRemoteActionJob({ kind: "collateral.remote-action", payload: { actionHash } }))
      .rejects.toThrow("remote-action-confirm-proof-rejected");

    expect(remoteActionRepo.acquireSigner).not.toHaveBeenCalled();
    expect(createWalletClient).not.toHaveBeenCalled();
  });
});
