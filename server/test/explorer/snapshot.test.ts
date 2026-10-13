import { beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotRepo } from "../../src/explorer/snapshot.repo.js";
import { ExplorerManifestModel, ExplorerRecordModel } from "../../src/explorer/snapshot.model.js";

vi.mock("../../src/config/env.js", () => ({ env: { monadChainId: 10143, core: `0x${"1".repeat(40)}` } }));
vi.mock("../../src/explorer/snapshot.model.js", () => ({
  ExplorerManifestModel: { findById: vi.fn(), create: vi.fn(), updateOne: vi.fn(), find: vi.fn(), deleteMany: vi.fn() },
  ExplorerRecordModel: { insertMany: vi.fn(), deleteMany: vi.fn() },
}));
const publication = { block: "20", updatedAt: "2026-10-13T12:00:00Z", version: "[]", houses: [], orders: [] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ExplorerManifestModel.findById).mockReturnValue({ maxTimeMS: () => ({ lean: async () => null }) } as never);
  vi.mocked(ExplorerManifestModel.updateOne).mockResolvedValue({ matchedCount: 1 } as never);
  vi.mocked(ExplorerManifestModel.find).mockReturnValue({ select: () => ({ lean: async () => [] }) } as never);
});
describe("Snapshot publication fencing", () => {
  it("publishes a complete generation only with a current lease", async () => {
    await snapshotRepo.publish(publication, "owner");
    const calls = vi.mocked(ExplorerManifestModel.updateOne).mock.calls;
    expect(calls[0][1]).toMatchObject({ $set: { complete: true } });
    expect(calls[1][0]).toMatchObject({ lease: "owner", leaseExpiresAt: { $gt: expect.any(Date) } });
    expect(calls[1][1]).toMatchObject({ $set: { complete: true, block: "20", orderCount: 0, houseCount: 0 } });
  });
  it("rejects an expired writer without deleting data that may already have been published", async () => {
    vi.mocked(ExplorerManifestModel.updateOne).mockResolvedValueOnce({ matchedCount: 1 } as never).mockResolvedValueOnce({ matchedCount: 0 } as never);
    await expect(snapshotRepo.publish(publication, "expired")).rejects.toThrow("explorer-snapshot-lease-lost");
    expect(ExplorerRecordModel.deleteMany).not.toHaveBeenCalled();
  });
  it("refuses a lower block and never serves incomplete generations", async () => {
    vi.mocked(ExplorerManifestModel.findById).mockReturnValue({ maxTimeMS: () => ({ lean: async () => ({ generation: "old", complete: true, block: "21" }) }) } as never);
    await expect(snapshotRepo.publish(publication, "owner")).rejects.toThrow("explorer-snapshot-regression");
    expect(ExplorerManifestModel.create).not.toHaveBeenCalled();
    vi.mocked(ExplorerManifestModel.findById).mockReturnValue({ maxTimeMS: () => ({ lean: async () => ({ generation: "partial", complete: false }) }) } as never);
    expect(await snapshotRepo.current()).toBeNull();
  });
});
