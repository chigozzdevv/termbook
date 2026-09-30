import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/chain/keeper.js", () => ({ keeperTransaction: vi.fn() }));
vi.mock("../../src/collateral/remote-action.service.js", () => ({ verifyAuthorizationReceipt: vi.fn() }));
vi.mock("../../src/collateral/topup.service.js", () => ({ topUpService: { confirmation: vi.fn() } }));
vi.mock("../../src/queue/queue.worker.js", () => ({ registerHandler: vi.fn(), drainQueue: vi.fn() }));
vi.mock("../../src/collateral/remote-action.repo.js", () => ({ remoteActionRepo: { find: vi.fn(), defer: vi.fn(), finishTopUp: vi.fn() } }));
vi.mock("../../src/collateral/remote-action.js", async (original) => ({ ...await original<typeof import("../../src/collateral/remote-action.js")>(), readAuthorizedAction: vi.fn() }));
import { monadClient } from "../../src/chain/monad.client.js";
import { keeperTransaction } from "../../src/chain/keeper.js";
import { topUpService } from "../../src/collateral/topup.service.js";
import { remoteActionRepo } from "../../src/collateral/remote-action.repo.js";
import { readAuthorizedAction, hashRemoteAction, serializeAction, type RemoteAction } from "../../src/collateral/remote-action.js";
import { handleRemoteActionJob } from "../../src/collateral/remote-action.worker.js";
import { env } from "../../src/config/env.js";
const hex = (n: string, length = 64) => `0x${n.repeat(length)}` as `0x${string}`;
const core = hex("1", 40), borrower = hex("2", 40);
const action: RemoteAction = { monadChain: 143n, monadCore: core, sourceChain: 1n, sourceVault: hex("3", 40),
  creditId: hex("4"), lockId: hex("5"), asset: hex("6", 40), recipient: borrower, kind: 2, amount: 20n, nonce: 1n, deadline: 2000n };
const actionHash = hashRemoteAction(action);
const old = { core: env.core, sourceRpcUrl: env.sourceRpcUrl, sourceBeaconApiUrl: env.sourceBeaconApiUrl,
  sourceActionKeeperKey: env.sourceActionKeeperKey, monadConfirmKeeperKey: env.monadConfirmKeeperKey };
let timestamp = 1000n;
const job = { kind: "collateral.remote-action", payload: { actionHash } };
beforeEach(() => {
  vi.resetAllMocks(); timestamp = 1000n;
  env.core = core; env.sourceRpcUrl = "https://eth.example"; env.sourceBeaconApiUrl = "https://beacon.example";
  env.sourceActionKeeperKey = hex("7"); env.monadConfirmKeeperKey = hex("8");
  vi.mocked(remoteActionRepo.find).mockResolvedValue({ actionHash, creditId: action.creditId, kind: 2,
    authorizationTxHash: hex("9"), state: "pending", action: serializeAction(action) } as never);
  vi.mocked(readAuthorizedAction).mockResolvedValue({ action, actionHash, collateralAmount: 100n });
  vi.mocked(monadClient).mockReturnValue({ getBlock: async () => ({ number: 10n, timestamp }),
    readContract: async ({ functionName }: { functionName: string }) => functionName === "collateralActionOutcome" ? 0 : { borrower } } as never);
  vi.mocked(topUpService.confirmation).mockResolvedValue({ to: core, data: "0xabcdef", actionHash, mode: "apply" });
  vi.mocked(keeperTransaction).mockResolvedValue("success");
});
afterEach(() => Object.assign(env, old));
describe("owner-funded top-up reconciliation", () => {
  it("waits for the owner to fund without sending any custody transaction", async () => {
    vi.mocked(topUpService.confirmation).mockRejectedValue(new Error("source-action-not-applied"));
    await handleRemoteActionJob(job);
    expect(remoteActionRepo.defer).toHaveBeenCalledWith(actionHash, 60_000);
    expect(keeperTransaction).not.toHaveBeenCalled();
    expect(remoteActionRepo.finishTopUp).not.toHaveBeenCalled();
  });
  it("journals only the verified Monad confirmation", async () => {
    await handleRemoteActionJob(job);
    expect(keeperTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: core,
      operation: `${actionHash}:topup:apply`, data: "0xabcdef" }));
    expect(remoteActionRepo.finishTopUp).toHaveBeenCalledWith(actionHash, 1);
  });
  it("clears an expired top-up only after obtaining nonexecution proof", async () => {
    timestamp = 2001n;
    vi.mocked(topUpService.confirmation).mockRejectedValueOnce(new Error("source-action-not-applied"))
      .mockResolvedValueOnce({ to: core, data: "0xabcdef", actionHash, mode: "expire" });
    await handleRemoteActionJob(job);
    expect(remoteActionRepo.finishTopUp).toHaveBeenCalledWith(actionHash, 2);
  });
  it("keeps custody pending when proof verification fails", async () => {
    vi.mocked(topUpService.confirmation).mockRejectedValue(new Error("source-action-proof-rejected"));
    await expect(handleRemoteActionJob(job)).rejects.toThrow("source-action-proof-rejected");
    expect(keeperTransaction).not.toHaveBeenCalled();
    expect(remoteActionRepo.finishTopUp).not.toHaveBeenCalled();
  });
});
