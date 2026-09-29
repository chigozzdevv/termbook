import { afterEach, describe, expect, it, vi } from "vitest";
import { creditRepo } from "../../src/credit/credit.repo.js";
import { CreditModel } from "../../src/credit/credit.model.js";

afterEach(() => vi.restoreAllMocks());
describe("credit projection revisions", () => {
  it("does not replace a newer projection when an old worker completes late", async () => {
    const update = vi.spyOn(CreditModel, "findOneAndUpdate").mockReturnValue({
      lean: async () => { throw { code: 11000 }; },
    } as never);
    vi.spyOn(CreditModel, "findOne").mockReturnValue({ lean: async () => ({ creditId: "credit", revision: 8 }) } as never);
    expect(await creditRepo.save({ creditId: "credit", revision: 7, observedBlock: 100 })).toMatchObject({ revision: 8 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      $and: expect.arrayContaining([{ $or: [{ revision: { $lte: 7 } }, { revision: { $exists: false } }] }]),
    }), expect.anything(), expect.anything());
  });

  it("does not replace newer accrued debt at the same credit revision", async () => {
    vi.spyOn(CreditModel, "findOneAndUpdate").mockReturnValue({ lean: async () => { throw { code: 11000 }; } } as never);
    vi.spyOn(CreditModel, "findOne").mockReturnValue({ lean: async () => ({ revision: 7, observedBlock: 101, debt: "200" }) } as never);
    expect(await creditRepo.save({ creditId: "credit", revision: 7, observedBlock: 100, debt: "100" }))
      .toMatchObject({ debt: "200", observedBlock: 101 });
  });
});
