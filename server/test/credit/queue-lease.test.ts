import { afterEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { queue } from "../../src/queue/queue.client.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("Mongo queue leases", () => {
  it("does not let an expired worker delete or retry another worker's claim", async () => {
    const model = mongoose.models["TermbookJob"]!;
    const remove = vi.spyOn(model, "deleteOne").mockResolvedValue({ deletedCount: 0 } as never);
    const update = vi.spyOn(model, "updateOne").mockResolvedValue({ modifiedCount: 0 } as never);
    await queue.complete("job", "old-lease");
    await queue.retry("job", "old-lease", 4);
    expect(remove).toHaveBeenCalledWith({ jobId: "job", status: "processing", lease: "old-lease" });
    expect(update).toHaveBeenCalledWith(
      { jobId: "job", status: "processing", lease: "old-lease" },
      expect.objectContaining({ $unset: { lease: 1, leaseExpiresAt: 1 } }));
  });

  it("cannot renew an expired lease and reports loss of ownership", async () => {
    const model = mongoose.models["TermbookJob"]!;
    const update = vi.spyOn(model, "updateOne").mockResolvedValue({ modifiedCount: 0 } as never);
    expect(await queue.renew("job", "lease")).toBe(false);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job", lease: "lease",
      leaseExpiresAt: { $gt: expect.any(Date) } }), expect.anything());
    update.mockResolvedValueOnce({ modifiedCount: 1 } as never);
    expect(await queue.renew("job", "lease")).toBe(true);
  });
});
