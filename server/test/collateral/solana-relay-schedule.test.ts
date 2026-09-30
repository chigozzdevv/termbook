import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEventTopics, encodeAbiParameters } from "viem";
import { termbookCoreAbi } from "@termbook/bindings";
vi.mock("../../src/chain/monad.client.js", () => ({ monadClient: vi.fn() }));
vi.mock("../../src/collateral/solana-action.service.js", () => ({ readSolanaAction: vi.fn() }));
vi.mock("../../src/collateral/solana-relay.config.js", () => ({ solanaRelayConfig: vi.fn() }));
vi.mock("../../src/collateral/solana-relay.repo.js", () => ({ solanaRelayRepo: { open: vi.fn() } }));
import { monadClient } from "../../src/chain/monad.client.js";
import { readSolanaAction } from "../../src/collateral/solana-action.service.js";
import { solanaRelayConfig } from "../../src/collateral/solana-relay.config.js";
import { solanaRelayRepo } from "../../src/collateral/solana-relay.repo.js";
import { remoteActionService } from "../../src/collateral/remote-action.service.js";
import { env } from "../../src/config/env.js";
const hash = `0x${"1".repeat(64)}` as const, core = `0x${"2".repeat(40)}` as const;
const request = { creditId: hash, kind: "release" as const, authorizationTxHash: hash };
beforeEach(() => {
  vi.resetAllMocks(); env.core = core;
  vi.mocked(solanaRelayConfig).mockResolvedValue({} as never);
  vi.mocked(readSolanaAction).mockResolvedValue({ actionHash: hash, action: { kind: 0 } } as never);
  vi.mocked(monadClient).mockReturnValue({ readContract: async () => true,
    getBlock: async () => ({ number: 20n, hash, transactions: [hash] }),
    getTransactionReceipt: async () => ({ status: "success", blockNumber: 20n, blockHash: hash, transactionIndex: 0,
      logs: [{ address: core, topics: encodeEventTopics({ abi: termbookCoreAbi, eventName: "RemoteActionAuthorized",
        args: { creditId: hash, actionHash: hash } }), data: encodeAbiParameters([{ type: "uint8" }], [0]) }] }),
  } as never);
});
describe("authorized SOL custody scheduling", () => {
  it("stores the finalized authorization for unattended source execution", async () => {
    expect(await remoteActionService.schedule(request, core)).toMatchObject({ actionHash: hash, state: "pending" });
    expect(readSolanaAction).toHaveBeenCalledWith({ creditId: hash, kind: "release" }, core);
    expect(solanaRelayRepo.open).toHaveBeenCalledWith({ _id: hash, creditId: hash, kind: 0, authorizationTxHash: hash });
  });
  it("does not queue unconfigured or unauthorized source execution", async () => {
    vi.mocked(solanaRelayConfig).mockResolvedValue(null);
    await expect(remoteActionService.schedule(request, core)).rejects.toThrow("remote-action-worker-unavailable");
    vi.mocked(solanaRelayConfig).mockResolvedValue({} as never);
    vi.mocked(readSolanaAction).mockRejectedValue(new Error("permission-denied"));
    await expect(remoteActionService.schedule(request, core)).rejects.toThrow("permission-denied");
    expect(solanaRelayRepo.open).not.toHaveBeenCalled();
  });
});
