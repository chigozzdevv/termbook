import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, keccak256, parseAbi } from "viem";

vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/source.client.js", () => ({ fetchUnconsumedActionProof: vi.fn() }));
vi.mock("../../src/collateral/remote-action.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/collateral/remote-action.js")>(), readAuthorizedAction: vi.fn(),
}));

import { monadClient } from "../../src/chain/monad.client.js";
import { fetchUnconsumedActionProof } from "../../src/chain/source.client.js";
import { env } from "../../src/config/env.js";
import { readAuthorizedAction, type RemoteAction } from "../../src/collateral/remote-action.js";
import { remoteActionService } from "../../src/collateral/remote-action.service.js";

const creditId = `0x${"11".repeat(32)}` as const;
const actionHash = `0x${"22".repeat(32)}` as const;
const core = `0x${"33".repeat(20)}` as const;
const vault = `0x${"44".repeat(20)}` as const;
const controller = `0x${"55".repeat(20)}` as const;
const verifier = `0x${"66".repeat(20)}` as const;
const requester = `0x${"77".repeat(20)}` as const;
const runtime = "0x1234" as const;
const codeHash = keccak256(runtime);
const controllerHash = `0x${"88".repeat(32)}` as const;
const action: RemoteAction = {
  monadChain: 143n, monadCore: core, sourceChain: 1n, sourceVault: vault,
  creditId, lockId: `0x${"99".repeat(32)}`, asset: `0x${"aa".repeat(20)}`,
  kind: 1, recipient: `0x${"bb".repeat(20)}`, amount: 100n, nonce: 1n, deadline: 100n,
};

function chain(accepted = true) {
  return {
    getBlock: vi.fn().mockResolvedValue({ number: 20n }),
    getCode: vi.fn().mockResolvedValue(runtime),
    readContract: vi.fn().mockImplementation(async ({ functionName }: { functionName: string }) => ({
      creditDetails: { verifierVersion: 1n, verifierCodeHash: codeHash },
      verifierRegistry: `0x${"cc".repeat(20)}`,
      verifiers: [verifier, 1n, true, 0n, codeHash],
      sourceVault: vault, sourceController: controller, sourceControllerCodeHash: controllerHash,
      verifyUnconsumedAction: accepted,
    })[functionName]),
    simulateContract: vi.fn().mockResolvedValue({}),
  };
}

beforeEach(() => {
  env.sourceRpcUrl = "https://ethereum.example";
  env.sourceProofUrl = "https://proof.example";
  env.core = core;
  vi.mocked(readAuthorizedAction).mockResolvedValue({ action, actionHash, collateralAmount: 100n });
  vi.mocked(fetchUnconsumedActionProof).mockResolvedValue({
    header: "0x1234", proof: "0xabcd", blockNumber: "0x10",
    blockHash: `0x${"dd".repeat(32)}`, stateRoot: `0x${"ee".repeat(32)}`,
    slot: `0x${"ff".repeat(32)}`, codeHash: controllerHash,
  });
});

afterEach(() => vi.clearAllMocks());

describe("expired remote seizure cancellation preparation", () => {
  it("returns a caller-signed Core transaction only after source absence verification", async () => {
    const monad = chain();
    vi.mocked(monadClient).mockReturnValue(monad as never);
    const result = await remoteActionService.prepareExpiredActionCancel({ creditId, kind: "seize" }, requester);
    expect(readAuthorizedAction).toHaveBeenCalledWith(creditId, 1, undefined, true);
    expect(fetchUnconsumedActionProof).toHaveBeenCalledWith({
      rpcUrl: env.sourceRpcUrl, finalityUrl: env.sourceProofUrl,
      actionHash, controller, expectedCodeHash: controllerHash, deadline: 100n,
    });
    expect(monad.simulateContract).toHaveBeenCalledOnce();
    const decoded = decodeFunctionData({
      abi: parseAbi(["function cancelExpiredRemoteSeizure(bytes32,bytes,bytes)"]),
      data: result.transaction.data,
    });
    expect(decoded.functionName).toBe("cancelExpiredRemoteSeizure");
    expect(decoded.args).toEqual([creditId, "0x1234", "0xabcd"]);
  });

  it("rejects an absence proof refused by the pinned verifier", async () => {
    const monad = chain(false);
    vi.mocked(monadClient).mockReturnValue(monad as never);
    await expect(remoteActionService.prepareExpiredActionCancel({ creditId, kind: "seize" }, requester))
      .rejects.toThrow("source-absence-proof-rejected");
    expect(monad.simulateContract).not.toHaveBeenCalled();
  });

  it("prepares expired return cancellation with the same finalized absence proof", async () => {
    const monad = chain();
    vi.mocked(monadClient).mockReturnValue(monad as never);
    const result = await remoteActionService.prepareExpiredActionCancel({ creditId, kind: "release" }, requester);
    expect(readAuthorizedAction).toHaveBeenCalledWith(creditId, 0, undefined, true);
    const decoded = decodeFunctionData({
      abi: parseAbi(["function cancelExpiredRemoteReturn(bytes32,bytes,bytes)"]),
      data: result.transaction.data,
    });
    expect(decoded.functionName).toBe("cancelExpiredRemoteReturn");
    expect(decoded.args).toEqual([creditId, "0x1234", "0xabcd"]);
  });
});
