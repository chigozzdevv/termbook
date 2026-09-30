import { beforeEach, describe, expect, it, vi } from "vitest";
import { riskRepo } from "../../src/risk/risk.repo.js";
const mocks = vi.hoisted(() => ({ update: vi.fn(), read: vi.fn() }));
vi.mock("../../src/risk/risk.model.js", () => ({ RiskModel: { updateOne: mocks.update,
  findById: () => ({ lean: mocks.read }) }, RiskScanModel: {} }));
const hash = `0x${"a".repeat(64)}`;
beforeEach(() => vi.resetAllMocks());
describe("monotonic risk observations", () => {
  it("uses an atomic block ordering condition for competing workers", async () => {
    await riskRepo.record("credit", { block: "12", blockHash: hash, state: "healthy" });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ _id: "credit", $or: [
      { blockOrder: { $exists: false } }, { blockOrder: { $lt: "12".padStart(78, "0") } },
      { blockOrder: "12".padStart(78, "0"), blockHash: hash },
    ] }), expect.anything(), { upsert: true });
  });
  it("does not replace a later observation when an older worker finishes", async () => {
    mocks.update.mockRejectedValue({ code: 11000 });
    mocks.read.mockResolvedValue({ blockOrder: "13".padStart(78, "0"), blockHash: hash });
    await expect(riskRepo.record("credit", { block: "12", blockHash: hash })).resolves.toBeUndefined();
  });
  it("reports a conflicting finalized hash rather than overwriting it", async () => {
    mocks.update.mockRejectedValue({ code: 11000 });
    mocks.read.mockResolvedValue({ blockOrder: "12".padStart(78, "0"), blockHash: `0x${"b".repeat(64)}` });
    await expect(riskRepo.record("credit", { block: "12", blockHash: hash })).rejects.toThrow("risk-finality-conflict");
  });
});
