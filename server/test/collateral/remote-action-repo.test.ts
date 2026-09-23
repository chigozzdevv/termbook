import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/collateral/remote-action.model.js", () => ({
  RemoteActionModel: { updateOne: vi.fn() },
  RemoteActionSignerModel: { updateOne: vi.fn() },
}));

import { RemoteActionModel } from "../../src/collateral/remote-action.model.js";
import { remoteActionRepo } from "../../src/collateral/remote-action.repo.js";

beforeEach(() => vi.clearAllMocks());

describe("remote action state CAS", () => {
  it("cannot regress a finalized source action to submitted", async () => {
    vi.mocked(RemoteActionModel.updateOne).mockResolvedValue({ matchedCount: 0 } as never);
    await remoteActionRepo.state("action", "submitted", "source-tx");
    expect(RemoteActionModel.updateOne).toHaveBeenCalledWith({
      actionHash: "action", txHash: "source-tx", state: { $in: ["prepared", "submitted"] },
    }, { $set: { state: "submitted" } });
  });

  it("cannot regress a finalized Monad confirmation to mined", async () => {
    vi.mocked(RemoteActionModel.updateOne).mockResolvedValue({ matchedCount: 0 } as never);
    await remoteActionRepo.confirmationState("action", "confirm_mined", "confirm-tx");
    expect(RemoteActionModel.updateOne).toHaveBeenCalledWith({
      actionHash: "action", confirmTxHash: "confirm-tx",
      state: { $in: ["confirm_prepared", "confirm_submitted", "confirm_mined"] },
    }, { $set: { state: "confirm_mined" } });
  });

  it("prepares one signed confirmation only after the source is finalized", async () => {
    vi.mocked(RemoteActionModel.updateOne).mockResolvedValue({ matchedCount: 1 } as never);
    await remoteActionRepo.prepareConfirmation("action", "confirm-tx", "raw", 7);
    expect(RemoteActionModel.updateOne).toHaveBeenCalledWith({
      actionHash: "action", confirmTxHash: { $exists: false }, state: "source_finalized",
    }, { $set: { confirmTxHash: "confirm-tx", confirmRawTx: "raw", confirmNonce: 7, state: "confirm_prepared" } });
  });
});
